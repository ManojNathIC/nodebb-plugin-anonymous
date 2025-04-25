"use strict";

const validator = require.main.require("validator");
const user = require.main.require("./src/user");
const db = require.main.require("./src/database");
const SocketPlugins = require.main.require("./src/socket.io/plugins");
const topics = require.main.require("./src/topics");
const plugins = require.main.require("./src/plugins");

const plugin = module.exports;

plugin.init = async function (params) {
  console.log("[Anonymous Posting] Initializing plugin with params:", params);
  const { router } = params;
  plugins.hooks.register("filter:api.response", plugin.filterApiResponse);
  // Add socket handler for anonymous posting
  SocketPlugins.anonymous = {
    toggleAnonymous: async function (socket, data) {
      console.log(
        "[Anonymous Posting] Toggle anonymous called with data:",
        data
      );
      if (!socket.uid) {
        console.log("[Anonymous Posting] Error: User not logged in");
        throw new Error("[[error:not-logged-in]]");
      }
      return { anonymous: data.anonymous };
    },
  };
};

// Handle topic creation to prevent Q&A data and set anonymous flag
plugin.filterTopicCreate = async function (hookData) {
  console.log(
    "[Anonymous Posting] Filter topic create called with data:",
    hookData.data
  );
  // Remove Q&A related fields from topic data
  delete hookData.data.isQuestion;
  delete hookData.data.isSolved;
  delete hookData.data.solvedPid;
  console.log(
    "[Anonymous Posting] Topic data after removing Q&A fields:",
    hookData.data
  );

  // Set anonymous flag if needed
  if (
    hookData.data.anonymous ||
    (hookData.data.composerData && hookData.data.composerData.anonymous)
  ) {
    console.log("[Anonymous Posting] Setting anonymous flag for topic");
    hookData.data.anonymous = true;
    // Save anonymous flag directly to database
    await db.setObjectField(`topic:${hookData.topic.tid}`, "anonymous", true);
  }

  return hookData;
};

// Handle topic after creation to remove Q&A data and ensure anonymous flag
plugin.actionTopicSave = async function (hookData) {
  console.log(
    "[Anonymous Posting] Action topic save called with topic:",
    hookData.topic
  );
  if (hookData.topic) {
    // Remove Q&A related fields from the topic
    await topics.deleteTopicFields(hookData.topic.tid, [
      "isQuestion",
      "isSolved",
      "solvedPid",
    ]);
    console.log(
      "[Anonymous Posting] Topic after removing Q&A fields:",
      hookData.topic
    );
    // Get the first post of the topic to check anonymous status
    const mainPid = hookData.topic.mainPid;
    if (mainPid) {
      const postData = await db.getObject(`post:${mainPid}`);
      console.log("[Anonymous Posting] Main post data:", postData);
      if (postData && postData.anonymous) {
        console.log("[Anonymous Posting] Setting anonymous flag on topic");
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
  console.log(
    "[Anonymous Posting] Filter post create called with data:",
    hookData.data
  );
  if (
    hookData.data.anonymous ||
    (hookData.data.composerData && hookData.data.composerData.anonymous)
  ) {
    console.log("[Anonymous Posting] Processing anonymous post");
    // Store the real user ID in a separate field
    const realUid = hookData.data.uid;
    console.log("[Anonymous Posting] Real user ID:", realUid);

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
      uid: 0,
    };

    // Save the data after post creation
    const pid = hookData.data.pid;
    if (pid) {
      console.log("[Anonymous Posting] Saving anonymous data for post:", pid);
      // First remove any existing Q&A data
      await db.deleteObjectFields(`post:${pid}`, [
        "isQuestion",
        "isSolved",
        "solvedPid",
      ]);

      console.log("[Anonymous Posting] Post data to save:", postData);

      // Then save anonymous data
      await db.setObject(`post:${pid}`, postData);

      // Also save anonymous flag in the post hash
      await db.setObjectField(`post:${pid}`, "anonymous", true);
      await db.setObjectField(`post:${pid}`, "anonymousUserId", realUid);
      await db.setObjectField(`post:${pid}`, "displayname", "Anonymous");
      await db.setObjectField(`post:${pid}`, "uid", 0);
    } else {
      // If pid is not available yet, store the data in the hookData for later use
      hookData.data.anonymousData = postData;
    }
  }
  return hookData;
};

// Add hook to handle post save
plugin.actionPostSave = async function (hookData) {
  console.log(
    "[Anonymous Posting] hookData with post:",
    hookData?.caller?.req?.body
  );
  console.log(
    "[Anonymous Posting] Action post save called with post:",
    hookData.post
  );
  if (hookData.post) {
    // Check if we have anonymous data stored in the hook
    if (hookData.caller.req.body.anonymous === true) {
      console.log(
        "[Anonymous Posting] Found anonymous data in hook:",
        hookData.caller.req.body
      );

      const pid = hookData.post.pid;

      // Save the anonymous data
      await db.setObject(`post:${pid}`, hookData.caller.req.body);

      // Update the post object
      hookData.post.anonymous = true;
      hookData.post.anonymousUserId = hookData.caller.req.body.anonymousUserId;
      hookData.post.displayname = "Anonymous";
      hookData.post.uid = 0;

      // Clean up the stored data
      // delete hookData.data.anonymousData;
    } else {
      // Get the post data from the database to check if it's anonymous
      const postData = await db.getObject(`post:${hookData.post.pid}`);
      console.log(
        "[Anonymous Posting] Post data from DB in actionPostSave:",
        postData
      );

      if (postData && postData.anonymous) {
        console.log(
          "[Anonymous Posting] Saving anonymous flag for post:",
          hookData.post.pid
        );
        // Ensure anonymous flag is saved in the database
        await db.setObjectField(`post:${hookData.post.pid}`, "anonymous", true);
        await db.setObjectField(
          `post:${hookData.post.pid}`,
          "anonymousUserId",
          postData.anonymousUserId
        );
        await db.setObjectField(
          `post:${hookData.post.pid}`,
          "displayname",
          "Anonymous"
        );
        await db.setObjectField(`post:${hookData.post.pid}`, "uid", 0);

        // Update the post object
        hookData.post.anonymous = true;
        hookData.post.anonymousUserId = postData.anonymousUserId;
        hookData.post.displayname = "Anonymous";
        hookData.post.uid = 0;
      }
    }
  }
  return hookData;
};

plugin.filterPostGet = async function (hookData) {
  console.log(
    "[Anonymous Posting] Filter post get called with posts:",
    hookData.posts
  );
  if (!hookData.posts || !hookData.posts.length) {
    return hookData;
  }

  const isAdmin = await user.isAdministrator(hookData.uid);
  console.log("[Anonymous Posting] Is admin:", isAdmin);

  for (const post of hookData.posts) {
    console.log("[Anonymous Posting] Processing post:", post.pid);
    // Get post data from database
    const postData = await db.getObject(`post:${post.pid}`);
    console.log("[Anonymous Posting] Post data from DB:", postData);

    // Remove any Q&A related data from the post
    delete post.isQuestion;
    delete post.isSolved;
    delete post.solvedPid;
    console.log("[Anonymous Posting] post.anonymous:", post.anonymous);
    console.log("[Anonymous Posting] postData.anonymous:", postData?.anonymous);

    // Check if post is anonymous
    const isAnonymous =
      postData &&
      (postData.anonymous === true ||
        postData.anonymous === "true" ||
        post.anonymous === true ||
        post.anonymous === "true");

    console.log("[Anonymous Posting] Is post anonymous:", isAnonymous);

    if (isAnonymous) {
      if (!isAdmin) {
        console.log(
          "[Anonymous Posting] Setting anonymous user data for non-admin"
        );
        // For non-admins, show as anonymous
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
        // Also modify the post content to show anonymous
        post.anonymous = true;
        // Ensure the display name is set
        post.user.displayname = "Anonymous";
        post.user.fullname = "Anonymous";
      } else {
        console.log(
          "[Anonymous Posting] Processing admin view of anonymous post"
        );
        // For admins, show the real user
        const realUid = postData.anonymousUserId || post.user.uid;
        if (realUid) {
          console.log(
            "[Anonymous Posting] Fetching real user data for admin:",
            realUid
          );
          // Fetch the real user data
          const userData = await user.getUserFields(realUid, [
            "username",
            "userslug",
            "picture",
            "displayname",
            "fullname",
          ]);
          console.log("[Anonymous Posting] Real user data:", userData);
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
  console.log("[Anonymous Posting] Filter composer build called");
  hookData.templateData.anonymousOption = true;
  return hookData;
};

// Add new filter to handle topic data
plugin.filterTopicGet = async function (hookData) {
  console.log(
    "[Anonymous Posting] Filter topic get called with topic:",
    hookData.topic
  );
  if (!hookData.topic) {
    console.log("hookData.topic", hookData.topic);

    return hookData;
  }

  const isAdmin = await user.isAdministrator(hookData.uid);
  const isTopicAuthor = hookData.topic.uid === hookData.uid;
  console.log(
    "[Anonymous Posting] Is admin:",
    isAdmin,
    "Is topic author:",
    isTopicAuthor
  );

  // Check if topic is anonymous
  // const isAnonymous = hookData.topic.anonymous;
  const isAnonymous =
    hookData.topic &&
    (hookData.topic.anonymous === true || hookData.topic.anonymous === "true");
  console.log("[Anonymous Posting] Is topic anonymous:", isAnonymous);

  if (!isAdmin) {
    console.log("[Anonymous Posting] Processing anonymous topic for non-admin");
    // For non-admins, anonymize the author information
    if (!isTopicAuthor && isAnonymous) {
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
      console.log("inside if of posts");

      for (const post of hookData.topic.posts) {
        console.log("inside for of posts");

        if (post.user) {
          console.log("inside if of post.user");

          const isPostAuthor = post.uid === hookData.uid;
          console.log(
            "[Anonymous Posting] Processing post:",
            post.pid,
            "Is post author:",
            isPostAuthor
          );
          // Check if post is anonymous
          const postIsAnonymous =
            post.anonymous === true || post.anonymous === "true";
          console.log(
            "[Anonymous Posting] Is post anonymous:",
            postIsAnonymous
          );
          if (!isAdmin && !isPostAuthor && postIsAnonymous) {
            console.log("isAdmin", isAdmin);
            console.log("isPostAuthor", isPostAuthor);
            console.log("isAnonymous", isAnonymous);

            console.log(
              "[Anonymous Posting] Setting anonymous user data for post"
            );
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
          // Check if toPid exists and get its anonymous status
          let isParentAnonymous = false;
          if (post.toPid) {
            // Check if post has parent data and is anonymous

            const parentPost = await db.getObject(`post:${post.toPid}`);
            console.log("parentPost", parentPost);
            if (
              parentPost.anonymous === "true" ||
              parentPost.anonymous === true
            ) {
              isParentAnonymous = true;
            }
          }
          if (
            (post?.parent && postIsAnonymous) ||
            (isParentAnonymous && !isAdmin && !isPostAuthor)
          ) {
            console.log("isParentAnonymous", isParentAnonymous);

            post.toPid = "0";
            const result = anonymizeMentions(post.content);
            console.log("result", result);
            post.content = result;

            post.parent = {
              username: "Anonymous",
              displayname: "Anonymous",
            };
          }
        }
      }
    }
  }

  return hookData;
};
// anonymizeMentions function
function anonymizeMentions(content) {
  return content.replace(
    /<a([^>]*?)href="[^"]*\/uid\/\d+"([^>]*?)>[^<]+<\/a>/g,
    '<a$1href="/uid/0"$2>anonymous</a>'
  );
}

// Add new hook to handle API v3 topic creation
plugin.filterTopicCreateV3 = async function (hookData) {
  console.log(
    "[Anonymous Posting] Filter topic create v3 called with data:",
    hookData.data
  );
  if (hookData.data && hookData.data.anonymous) {
    console.log("[Anonymous Posting] Setting anonymous flag for v3 topic");
    // Store anonymous flag in the database
    await db.setObjectField(`topic:${hookData.topic.tid}`, "anonymous", true);

    // Also store anonymous flag for the first post
    if (hookData.topic.mainPid) {
      console.log(
        "[Anonymous Posting] Setting anonymous flag for main post:",
        hookData.topic.mainPid
      );
      await db.setObjectField(
        `post:${hookData.topic.mainPid}`,
        "anonymous",
        true
      );
    }
  }
  return hookData;
};

// Add new hook to handle API v3 post creation
plugin.filterPostCreateV3 = async function (hookData) {
  console.log(
    "[Anonymous Posting] Filter post create v3 called with data:",
    hookData.data
  );

  if (hookData.data && hookData.data.anonymous) {
    console.log("[Anonymous Posting] Processing anonymous v3 post");
    // Store anonymous flag in the database
    const pid = hookData.post.pid;
    const tid = hookData.post.tid;
    console.log("[Anonymous Posting] Post ID:", pid, "Topic ID:", tid);

    // Store anonymous data in post hash
    const postData = {
      anonymous: true,
      anonymousUserId: hookData.post.uid,
      displayname: "Anonymous",
    };

    // First remove any existing Q&A data
    await db.deleteObjectFields(`post:${pid}`, [
      "isQuestion",
      "isSolved",
      "solvedPid",
    ]);

    console.log("[Anonymous Posting] Saving v3 post data:", postData);

    // Then save anonymous data
    await db.setObject(`post:${pid}`, postData);

    // Also save anonymous flag in the post hash
    await db.setObjectField(`post:${pid}`, "anonymous", true);

    // If this is the first post, also set the topic as anonymous
    if (hookData.post.isMain) {
      console.log("[Anonymous Posting] Setting anonymous flag for v3 topic");
      await db.setObjectField(`topic:${tid}`, "anonymous", true);
    }

    // Update the post object
    hookData.post.anonymous = true;
    hookData.post.anonymousUserId = hookData.post.uid;
  }
  return hookData;
};

// Add new hook to handle API v3 topic data retrieval
plugin.filterTopicGetV3 = async function (hookData) {
  console.log(
    "[Anonymous Posting] Filter topic get v3 called with topic:",
    hookData.topic
  );
  if (!hookData.topic) {
    return hookData;
  }

  const isAdmin = await user.isAdministrator(hookData.uid);
  const isTopicAuthor = hookData.topic.uid === hookData.uid;
  console.log(
    "[Anonymous Posting] Is admin:",
    isAdmin,
    "Is topic author:",
    isTopicAuthor
  );

  // Check if topic is anonymous
  const isAnonymous = hookData.topic.anonymous;
  console.log("[Anonymous Posting] Is topic anonymous:", isAnonymous);

  if (isAnonymous && !isAdmin) {
    console.log(
      "[Anonymous Posting] Processing anonymous v3 topic for non-admin"
    );
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
          console.log(
            "[Anonymous Posting] Processing v3 post:",
            post.pid,
            "Is post author:",
            isPostAuthor
          );
          if (!isAdmin && !isPostAuthor) {
            console.log(
              "[Anonymous Posting] Setting anonymous user data for v3 post"
            );
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

plugin.filterRepliesGet = async function (hookData) {
  // If this is an array of posts (API v3 case), use the new handler
  if (Array.isArray(hookData)) {
    return plugin.filterRepliesGetV3(hookData);
  }

  console.log(
    "[Anonymous Posting] Filter post replies called with data:",
    hookData
  );
  if (!hookData.replies || !hookData.replies.length) {
    return hookData;
  }

  const isAdmin = await user.isAdministrator(hookData.uid);
  console.log("[Anonymous Posting] Is admin:", isAdmin);

  // Get the parent post ID from the URL
  const parentPid = getParentPidFromUrl(hookData.caller?.req?.originalUrl);
  console.log("[Anonymous Posting] Parent PID:", parentPid);

  // Check if parent post is anonymous
  let isParentAnonymous = false;
  if (parentPid) {
    const parentPost = await db.getObject(`post:${parentPid}`);
    isParentAnonymous =
      parentPost?.anonymous === true || parentPost?.anonymous === "true";
    console.log("[Anonymous Posting] Is parent anonymous:", isParentAnonymous);
  }

  // Process each reply
  for (let i = 0; i < hookData.replies.length; i++) {
    const reply = hookData.replies[i];
    console.log("[Anonymous Posting] Processing reply:", reply.pid);

    // Get the full post data from database
    const postData = await db.getObject(`post:${reply.pid}`);
    console.log("[Anonymous Posting] Post data from DB:", postData);

    // Check if this specific reply is anonymous
    const isReplyAnonymous =
      postData?.anonymous === true || postData?.anonymous === "true";
    console.log("[Anonymous Posting] Is reply anonymous:", isReplyAnonymous);

    // Only process if either the reply itself is anonymous OR the parent is anonymous
    if (isReplyAnonymous || isParentAnonymous) {
      if (!isAdmin) {
        console.log(
          "[Anonymous Posting] Setting anonymous user data for non-admin reply"
        );
        reply.user = {
          username: "Anonymous",
          userslug: "anonymous",
          picture: "",
          uid: 0,
          displayname: "Anonymous",
          fullname: "Anonymous",
          "icon:bgColor": "#666666",
          "icon:text": "A",
        };
        reply.anonymous = true;
      } else {
        console.log(
          "[Anonymous Posting] Processing admin view of anonymous reply"
        );
        const realUid = postData?.anonymousUserId || reply.uid;
        if (realUid) {
          console.log(
            "[Anonymous Posting] Fetching real user data for admin:",
            realUid
          );
          const userData = await user.getUserFields(realUid, [
            "username",
            "userslug",
            "picture",
            "displayname",
            "fullname",
          ]);
          console.log("[Anonymous Posting] Real user data:", userData);
          reply.user = {
            username: userData.username,
            userslug: userData.userslug,
            picture: userData.picture,
            uid: realUid,
            displayname: userData.displayname || userData.username,
            fullname: userData.fullname || userData.username,
          };
        }
        reply.anonymous = true;
      }
    } else {
      console.log("[Anonymous Posting] Reply is not anonymous, skipping");
    }
  }

  return hookData;
};

// Add new hook to handle posts
plugin.filterPostsGet = async function (hookData) {
  console.log(
    "[Anonymous Posting] Filter posts get called with data:",
    hookData.caller
  );
  if (!hookData.posts || !hookData.posts.length) {
    return hookData;
  }

  const isAdmin = await user.isAdministrator(hookData.uid);
  console.log("[Anonymous Posting] Is admin:", isAdmin);

  for (const post of hookData.posts) {
    console.log("[Anonymous Posting] Processing post:", post.pid);
    console.log("[Anonymous Posting] Post data:", post);

    // Get post data from database to ensure we have the anonymous flag
    const postData = await db.getObject(`post:${post.pid}`);
    console.log("[Anonymous Posting] Post data from DB:", postData);

    // Check if post is anonymous
    const isAnonymous =
      (postData &&
        (postData.anonymous === true || postData.anonymous === "true")) ||
      post.anonymous === true ||
      post.anonymous === "true";

    console.log("[Anonymous Posting] Is post anonymous:", isAnonymous);

    if (isAnonymous) {
      if (!isAdmin) {
        console.log(
          "[Anonymous Posting] Setting anonymous user data for non-admin post"
        );
        // For non-admins, show as anonymous
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
        // Also modify the post content to show anonymous
        post.anonymous = true;
        // Ensure the display name is set
        post.user.displayname = "Anonymous";
        post.user.fullname = "Anonymous";
      } else {
        console.log(
          "[Anonymous Posting] Processing admin view of anonymous post"
        );
        // For admins, show the real user
        const realUid = postData?.anonymousUserId || post.uid;
        if (realUid) {
          console.log(
            "[Anonymous Posting] Fetching real user data for admin:",
            realUid
          );
          // Fetch the real user data
          const userData = await user.getUserFields(realUid, [
            "username",
            "userslug",
            "picture",
            "displayname",
            "fullname",
          ]);
          console.log("[Anonymous Posting] Real user data:", userData);
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

// Add this helper function at the top of your plugin
const getParentPidFromUrl = (url) => {
  if (!url) return null;
  const parts = url.split("/");
  // The URL pattern is /api/v3/posts/{pid}/replies
  const pidIndex = parts.indexOf("posts") + 1;
  return parts[pidIndex] || null;
};

plugin.filterRepliesGetV3 = async function (hookData) {
  if (!hookData || !hookData.length) {
    return hookData;
  }

  const isAdmin = await user.isAdministrator(hookData[0]?.uid);
  const parentPid = getParentPidFromUrl(hookData[0]?.caller?.req?.originalUrl);

  // Get all post data in one batch
  const postPids = hookData.map((post) => post.pid);
  const postDataArray = await db.getObjects(
    postPids.map((pid) => `post:${pid}`)
  );
  const postDataMap = new Map(
    postDataArray.map((data, index) => [postPids[index], data])
  );

  // Check parent post anonymity if needed
  let isParentAnonymous = false;
  if (parentPid) {
    const parentPost = await db.getObject(`post:${parentPid}`);
    isParentAnonymous =
      parentPost?.anonymous === true || parentPost?.anonymous === "true";
  }

  // Process all posts in parallel
  await Promise.all(
    hookData.map(async (post) => {
      const postData = postDataMap.get(post.pid);
      const isAnonymous =
        postData?.anonymous === true ||
        postData?.anonymous === "true" ||
        isParentAnonymous;

      if (isAnonymous) {
        if (!isAdmin) {
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
          post.anonymous = true;
        } else {
          const realUid = postData?.anonymousUserId || post.uid;
          if (realUid) {
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
          post.anonymous = true;
        }
      }
    })
  );

  return hookData;
};

plugin.filterApiResponse = async function (hookData) {
  if (hookData.path === "/api/v3/posts/:pid/replies") {
    // This will be called after filterRepliesGetV3
    if (hookData.response && Array.isArray(hookData.response)) {
      // Process each reply in the response
      for (const reply of hookData.response) {
        if (reply.anonymous) {
          // Add any additional fields you want to include in the API response
          reply.isAnonymous = true;
          reply.anonymousSince = reply.timestamp;
        }
      }
    }
  }
  return hookData;
};
