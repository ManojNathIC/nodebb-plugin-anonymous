"use strict";

const validator = require.main.require("validator");
const user = require.main.require("./src/user");
const db = require.main.require("./src/database");
const SocketPlugins = require.main.require("./src/socket.io/plugins");
const topics = require.main.require("./src/topics");

const plugin = module.exports;

plugin.init = async function (params) {
  const { router } = params;

  // Add socket handler for anonymous posting
  SocketPlugins.anonymous = {
    toggleAnonymous: async function (socket, data) {
      if (!socket.uid) {
        throw new Error("[[error:not-logged-in]]");
      }
      return { anonymous: data.anonymous };
    },
  };
};

// Handle topic creation to prevent Q&A data and set anonymous flag
plugin.filterTopicCreate = async function (hookData) {
  // Remove Q&A related fields from topic data
  delete hookData.data.isQuestion;
  delete hookData.data.isSolved;
  delete hookData.data.solvedPid;

  // Set anonymous flag if needed
  if (
    hookData.data.anonymous ||
    (hookData.data.composerData && hookData.data.composerData.anonymous)
  ) {
    hookData.data.anonymous = true;
    // Save anonymous flag directly to database
    await db.setObjectField(`topic:${hookData.topic.tid}`, "anonymous", true);
  }

  return hookData;
};

// Handle topic after creation to remove Q&A data and ensure anonymous flag
plugin.actionTopicSave = async function (hookData) {
  if (hookData.topic) {
    // Remove Q&A related fields from the topic
    await topics.deleteTopicFields(hookData.topic.tid, [
      "isQuestion",
      "isSolved",
      "solvedPid",
    ]);

    // Get the first post of the topic to check anonymous status
    const mainPid = hookData.topic.mainPid;
    if (mainPid) {
      const postData = await db.getObject(`post:${mainPid}`);
      if (postData && postData.anonymous) {
        // Set anonymous flag on topic
        await db.setObjectField(
          `topic:${hookData.topic.tid}`,
          "anonymous",
          true
        );
      }
    }
  }
  return hookData;
};

// Add anonymous posting functionality
plugin.filterPostCreate = async function (hookData) {
  if (
    hookData.data.anonymous ||
    (hookData.data.composerData && hookData.data.composerData.anonymous)
  ) {
    // Store the real user ID in a separate field
    const realUid = hookData.data.uid;

    // Remove any Q&A related data
    delete hookData.data.isQuestion;
    delete hookData.data.isSolved;
    delete hookData.data.solvedPid;

    // Set the post data
    hookData.data.anonymousUserId = realUid;
    hookData.data.displayname = "Anonymous";
    hookData.data.uid = 0;
    hookData.data.anonymous = true;

    // Save anonymous data in post hash
    const postData = {
      anonymous: true,
      anonymousUserId: realUid,
      displayname: "Anonymous",
    };

    // Save the data after post creation
    const pid = hookData.data.pid;
    if (pid) {
      // First remove any existing Q&A data
      await db.deleteObjectFields(`post:${pid}`, [
        "isQuestion",
        "isSolved",
        "solvedPid",
      ]);
      // Then save anonymous data
      await db.setObject(`post:${pid}`, postData);

      // Also save anonymous flag in the post hash
      await db.setObjectField(`post:${pid}`, "anonymous", true);
    }
  }
  return hookData;
};

// Add hook to handle post save
plugin.actionPostSave = async function (hookData) {
  if (hookData.post && hookData.post.anonymous) {
    // Ensure anonymous flag is saved in the database
    await db.setObjectField(`post:${hookData.post.pid}`, "anonymous", true);
  }
  return hookData;
};

plugin.filterPostGet = async function (hookData) {
  if (!hookData.posts || !hookData.posts.length) {
    return hookData;
  }

  const isAdmin = await user.isAdministrator(hookData.uid);

  for (const post of hookData.posts) {
    // Get post data from database
    const postData = await db.getObject(`post:${post.pid}`);

    // Remove any Q&A related data from the post
    delete post.isQuestion;
    delete post.isSolved;
    delete post.solvedPid;

    // Check if post is anonymous
    const isAnonymous = postData && (postData.anonymous || post.anonymous);

    if (isAnonymous) {
      if (!isAdmin) {
        // For non-admins, show as anonymous
        post.user = {
          username: "Anonymous",
          userslug: "anonymous",
          picture: "",
          uid: 0,
          displayname: "Anonymous",
          fullname: "Anonymous",
        };
        // Also modify the post content to show anonymous
        post.anonymous = true;
        // Ensure the display name is set
        post.user.displayname = "Anonymous";
        post.user.fullname = "Anonymous";
      } else {
        // For admins, show the real user
        const realUid = postData.anonymousUserId || post.user.uid;
        if (realUid) {
          // Fetch the real user data
          const userData = await user.getUserFields(realUid, [
            "username",
            "userslug",
            "picture",
            "displayname",
            "fullname",
          ]);
          post.user = {
            username: userData.username,
            userslug: userData.userslug,
            picture: userData.picture,
            uid: realUid,
            displayname: userData.displayname || userData.username,
            fullname: userData.fullname || userData.username,
          };
        }
        // Add anonymous indicator for admins
        post.anonymous = true;
      }
    }
  }

  return hookData;
};

// Add anonymous option to composer
plugin.filterComposerBuild = async function (hookData) {
  hookData.templateData.anonymousOption = true;
  return hookData;
};

// Add new filter to handle topic data
plugin.filterTopicGet = async function (hookData) {
  if (!hookData.topic) {
    return hookData;
  }

  const isAdmin = await user.isAdministrator(hookData.uid);
  const isTopicAuthor = hookData.topic.uid === hookData.uid;

  // Check if topic is anonymous
  const isAnonymous = hookData.topic.anonymous;

  if (isAnonymous && !isAdmin) {
    // For non-admins, anonymize the author information
    if (!isTopicAuthor) {
      hookData.topic.author = {
        username: "Anonymous",
        userslug: "anonymous",
        uid: 0,
        displayname: "Anonymous",
        picture: "",
        "icon:bgColor": "#666666",
        "icon:text": "A",
      };
    }

    // Also anonymize the user information in posts
    if (hookData.topic.posts && hookData.topic.posts.length) {
      for (const post of hookData.topic.posts) {
        if (post.user) {
          const isPostAuthor = post.uid === hookData.uid;
          if (!isAdmin && !isPostAuthor) {
            post.user = {
              username: "Anonymous",
              userslug: "anonymous",
              picture: "",
              uid: 0,
              displayname: "Anonymous",
              fullname: "Anonymous",
              "icon:bgColor": "#666666",
              "icon:text": "A",
            };
          }
        }
      }
    }
  }

  return hookData;
};
