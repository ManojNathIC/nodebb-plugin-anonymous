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

  // Add hook to store designation and location when plugin initializes
  plugins.hooks.register("action:app.load", async function () {
    console.log(
      "[Anonymous Posting] Plugin initialization - storing designation and location"
    );
    try {
      // Get all users
      const uids = await db.getSortedSetRange("users:joindate", 0, -1);

      for (const uid of uids) {
        // Get user data
        const userData = await user.getUserFields(uid, [
          "username",
          "designation",
          "location",
        ]);

        // If designation or location is not set, set default values
        if (!userData.designation || !userData.location) {
          await db.setObjectFields(`user:${uid}`, {
            designation: userData.designation || "Not Available",
            location: userData.location || "Not Available",
          });
          console.log(
            `[Anonymous Posting] Set default designation and location for user ${uid}`
          );
        }
      }
    } catch (err) {
      console.error(
        "[Anonymous Posting] Error during plugin initialization:",
        err
      );
    }
  });

  console.log(
    "[Anonymous Posting] Registering route /api/v3/posts/:pid/replies"
  );
  router.get("/api/v3/posts/:pid/replies", async (req, res, next) => {
    console.log("[Anonymous Posting] Replies endpoint hit with pid:", req);

    // Store the original json method
    const originalJson = res.json;

    // Override the json method to modify the response
    res.json = async function (data) {
      console.log(
        "[Anonymous Posting] Original response data:",
        data.response.replies
      );

      if (Array.isArray(data.response.replies)) {
        // Process each reply
        for (const reply of data.response.replies) {
          // Get post data from database
          const postData = await db.getObject(`post:${reply.pid}`);
          console.log("[Anonymous Posting] Post data from DB:", postData);

          // Check if post is anonymous
          const isAnonymous =
            postData?.anonymous === true || postData?.anonymous === "true";
          console.log("[Anonymous Posting] Is reply anonymous:", isAnonymous);
          // Check if user is admin
          const isAdmin = await user.isAdministrator(req.uid);
          console.log("[Anonymous Posting] Is admin:", isAdmin);
          // Check if toPid exists and get its anonymous status
          let isParentAnonymous = false;
          if (reply.toPid) {
            // Check if post has parent data and is anonymous

            const parentPost = await db.getObject(`post:${reply.toPid}`);
            console.log("parentPost", parentPost);
            if (
              parentPost.anonymous === "true" ||
              parentPost.anonymous === true
            ) {
              isParentAnonymous = true;
            }
          }
          if (!isAdmin) {
            if ((reply?.parent && isAnonymous) || isParentAnonymous) {
              console.log("isParentAnonymous", isParentAnonymous);

              reply.toPid = "0";
              const result = anonymizeMentions(reply.content);
              console.log("result", result);
              reply.content = result;

              reply.parent = {
                username: "Anonymous",
                displayname: "Anonymous",
              };
            }
          }
          if (isAnonymous) {
            if (!isAdmin) {
              // For non-admins, anonymize the reply
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
              for (const item of reply.replies.users) {
                item.username = "Anonymous";
                item.userslug = "anonymous";
                item.picture = "";
                item.uid = 0;
                item.displayname = "Anonymous";
                item.fullname = "Anonymous";
                item["icon:bgColor"] = "#666666";
                item["icon:text"] = "A";
              }

              reply.anonymous = true;
            } else {
              // For admins, show real user but mark as anonymous
              const realUid = postData.anonymousUserId;
              if (realUid) {
                const userData = await user.getUserFields(realUid, [
                  "username",
                  "userslug",
                  "picture",
                  "displayname",
                  "fullname",
                ]);
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
          }
          reply.uid = 0;
        }
      }

      console.log(
        "[Anonymous Posting] Modified response data:",
        data.response.replies
      );
      // Call the original json method with modified data
      originalJson.call(this, data);
    };

    next();
  });

  // New custom API endpoint for /api/popular
  router.get("/api/popular", async (req, res, next) => {
    console.log("[Anonymous Posting] /api/popular endpoint hit");
    // Store the original json method
    const originalJson = res.json;
    // Override the json method to modify the response
    res.json = async function (data) {
      console.log(
        "[Anonymous Posting] Original /api/popular response data:",
        data
      );
      // Handle both array and object-with-array responses
      let topicsArr = [];
      if (Array.isArray(data)) {
        topicsArr = data;
      } else if (data && Array.isArray(data.topics)) {
        topicsArr = data.topics;
      } else {
        topicsArr = [data];
      }
      if (topicsArr.length) {
        const isAdmin = await user.isAdministrator(req.uid);
        for (const topic of topicsArr) {
          const isTopicAuthor = topic.uid === req.uid;
          const isTopicAnonymous =
            topic.anonymous === true || topic.anonymous === "true";
          if (!isAdmin && !isTopicAuthor && isTopicAnonymous) {
            topic.uid = 0;
            topic.user = { ...anonymousUser };
            if (topic.teaser && topic.teaser.user) {
              const isTeaserAuthor = topic.teaser.uid === req.uid;
              if (!isAdmin && !isTeaserAuthor) {
                topic.teaser.uid = 0;
                topic.teaser.user = { ...anonymousUser };
              }
            }
          } else {
            // Not anonymous: fetch user details from DB
            if (topic.uid) {
              const userData = await user.getUserFields(topic.uid, [
                "username",
                "user_id",
                "designation",
                "location",
                "fullname",
              ]);
              console.log("userData", userData);

              topic.user = {
                ...topic.user,
                user_id: userData.user_id,
                designation: userData.designation,
                location: userData.location,
                fullname: userData.fullname,
              };
            }
            // Teaser user
            if (topic.teaser && topic.teaser.uid) {
              const teaserUserData = await user.getUserFields(
                topic.teaser.uid,
                ["username", "user_id", "designation", "location", "fullname"]
              );
              topic.teaser.user = {
                ...topic.teaser.user,
                user_id: teaserUserData.user_id,
                designation: teaserUserData.designation,
                location: teaserUserData.location,
                fullname: teaserUserData.fullname,
              };
            }
          }
        }
      }
      console.log(
        "[Anonymous Posting] Modified /api/popular response data:",
        data
      );
      originalJson.call(this, data);
    };
    next();
  });

  // Wildcard GET route to catch all requests
  router.get("*", async (req, res, next) => {
    console.log("[Anonymous Posting] endpoint hit");
    const originalJson = res.json;
    res.json = async function (data) {
      console.log(
        "[Anonymous Posting] Original response data:",
        JSON.stringify(data, null, 2)
      );

      // Check if this is the user topics route
      if (
        (req.route && req.route.path === "/api/user/:userslug/topics") ||
        (req.route && req.route.path === "/api/user/:userslug/posts") ||
        (req.route && req.route.path === "/api/user/:userslug/best")
      ) {
        const isAdmin = await user.isAdministrator(req.uid);
        const requestedUserSlug = req.params.userslug;
        const requestedUser = await user.getUidByUserslug(requestedUserSlug);
        const isAuthor = requestedUser === req.uid;

        // For non-admin and non-author users, remove anonymous data
        if (Array.isArray(data.posts)) {
          // For posts and best routes, we need to check both post and topic details
          if (
            req.route.path === "/api/user/:userslug/posts" ||
            req.route.path === "/api/user/:userslug/best"
          ) {
            // Get all post IDs and topic IDs
            const postIds = data.posts.map((post) => post.pid).filter(Boolean);
            const topicIds = data.posts.map((post) => post.tid).filter(Boolean);

            if (postIds.length && topicIds.length) {
              // Get all posts and topics data in one batch
              const [postsData, topicsData] = await Promise.all([
                db.getObjects(postIds.map((pid) => `post:${pid}`)),
                db.getObjects(topicIds.map((tid) => `topic:${tid}`)),
              ]);

              const postsMap = new Map(
                postsData.map((post, index) => [postIds[index], post])
              );
              const topicsMap = new Map(
                topicsData.map((topic, index) => [topicIds[index], topic])
              );

              // Filter out posts that are either anonymous themselves or belong to anonymous topics
              data.posts = data.posts.filter((post) => {
                const postData = postsMap.get(post.pid);
                const topicData = topicsMap.get(post.tid);

                // Check if post is anonymous in DB or belongs to anonymous topic
                const isPostAnonymous =
                  postData &&
                  (postData.anonymous === true ||
                    postData.anonymous === "true");
                const isTopicAnonymous =
                  topicData &&
                  (topicData.anonymous === true ||
                    topicData.anonymous === "true");

                return !isPostAnonymous && !isTopicAnonymous;
              });
            }
          } else {
            data.posts = data.posts.filter((topic) => !topic.anonymous);
          }
        } else if (data && Array.isArray(data.posts)) {
          // Handle object response with posts array
          if (
            req.route.path === "/api/user/:userslug/posts" ||
            req.route.path === "/api/user/:userslug/best"
          ) {
            const postIds = data.posts.map((post) => post.pid).filter(Boolean);
            const topicIds = data.posts.map((post) => post.tid).filter(Boolean);

            if (postIds.length && topicIds.length) {
              const [postsData, topicsData] = await Promise.all([
                db.getObjects(postIds.map((pid) => `post:${pid}`)),
                db.getObjects(topicIds.map((tid) => `topic:${tid}`)),
              ]);

              const postsMap = new Map(
                postsData.map((post, index) => [postIds[index], post])
              );
              const topicsMap = new Map(
                topicsData.map((topic, index) => [topicIds[index], topic])
              );

              data.posts = data.posts.filter((post) => {
                const postData = postsMap.get(post.pid);
                const topicData = topicsMap.get(post.tid);

                // Check if post is anonymous in DB or belongs to anonymous topic
                const isPostAnonymous =
                  postData &&
                  (postData.anonymous === true ||
                    postData.anonymous === "true");
                const isTopicAnonymous =
                  topicData &&
                  (topicData.anonymous === true ||
                    topicData.anonymous === "true");

                return !isPostAnonymous && !isTopicAnonymous;
              });
            }
          } else {
            data.posts = data.posts.filter((topic) => !topic.anonymous);
          }
        }
      }

      let topicsArr = [];
      if (Array.isArray(data)) {
        topicsArr = data;
      } else if (data && Array.isArray(data.topics)) {
        topicsArr = data.topics;
      } else {
        topicsArr = [data];
      }

      if (topicsArr.length) {
        const isAdmin = await user.isAdministrator(req.uid);
        for (const topic of topicsArr) {
          const isTopicAuthor = topic.uid === req.uid;
          const isTopicAnonymous =
            topic.anonymous === true || topic.anonymous === "true";
          if (!isAdmin && !isTopicAuthor && isTopicAnonymous) {
            topic.uid = 0;
            topic.user = { ...anonymousUser };
            if (topic.teaser && topic.teaser.user) {
              const isTeaserAuthor = topic.teaser.uid === req.uid;
              if (!isAdmin && !isTeaserAuthor) {
                topic.teaser.uid = 0;
                topic.teaser.user = { ...anonymousUser };
              }
            }
          } else {
            // Not anonymous: fetch user details from DB
            if (topic.uid) {
              const userData = await user.getUserFields(topic.uid, [
                "username",
                "user_id",
                "designation",
                "location",
                "fullname",
              ]);
              console.log("userData", userData);

              topic.user = {
                ...topic.user,
                user_id: userData.user_id,
                designation: userData.designation,
                location: userData.location,
                fullname: userData.fullname,
              };
            }

            // Teaser user
            if (topic.teaser && topic.teaser.uid) {
              const teaserUserData = await user.getUserFields(
                topic.teaser.uid,
                ["username", "user_id", "designation", "location", "fullname"]
              );
              topic.teaser.user = {
                ...topic.teaser.user,
                user_id: teaserUserData.user_id,
                designation: teaserUserData.designation,
                location: teaserUserData.location,
                fullname: teaserUserData.fullname,
              };
            }
          }

          // Handle posts within topics
          if (topic.posts && Array.isArray(topic.posts)) {
            for (const post of topic.posts) {
              const isPostAuthor = post.uid === req.uid;
              const isPostAnonymous =
                post.anonymous === true || post.anonymous === "true";

              if (!isAdmin && !isPostAuthor && isPostAnonymous) {
                post.uid = 0;
                post.user = { ...anonymousUser };
              } else if (post.uid) {
                const postUserData = await user.getUserFields(post.uid, [
                  "username",
                  "user_id",
                  "designation",
                  "location",
                  "fullname",
                ]);
                post.user = {
                  ...post.user,
                  user_id: postUserData.user_id,
                  designation: postUserData.designation,
                  location: postUserData.location,
                  fullname: postUserData.fullname,
                };
              }
            }
          }
        }
      }
      console.log(
        "[Anonymous Posting] Modified /discussion-forum/api response data:",
        data
      );
      originalJson.call(this, data);
    };
    next();
  });

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

  // Catch-all logger for all API requests
  router.use((req, res, next) => {
    if (
      req.originalUrl.startsWith("/api") ||
      req.originalUrl.startsWith("/discussion-forum/api")
    ) {
      console.log("[Anonymous Posting] API request hit:", req.originalUrl);
    }
    next();
  });

  // Add hook to store designation and location when user logs in
  plugins.hooks.register("action:user.login", async function (hookData) {
    const { uid } = hookData;

    if (uid) {
      console.log(
        "[Anonymous Posting] Storing designation and location for user:",
        uid
      );
      await db.setObjectFields(`user:${uid}`, {
        designation: designation,
        location: location,
      });
    }
    return hookData;
  });
};

// Handle topic creation to prevent Q&A data and set anonymous flag
plugin.filterTopicCreate = async function (hookData) {
  console.log(
    "[Anonymous Posting] Filter topic create called with data:",
    hookData.data
  );

  // Check if both anonymous and question data exist
  const hasQuestionData = hookData.data.isQuestion === true;
  const isAnonymous =
    hookData.data.anonymous === true ||
    (hookData.data.composerData &&
      hookData.data.composerData.anonymous === true);

  console.log("[Anonymous Posting] Has question data:", hasQuestionData);
  console.log("[Anonymous Posting] Is anonymous:", isAnonymous);

  // If anonymous but no question data, remove Q&A fields
  if (isAnonymous && !hasQuestionData) {
    console.log(
      "[Anonymous Posting] Removing Q&A fields for anonymous non-question topic"
    );
    delete hookData.data.isQuestion;
    delete hookData.data.isSolved;
    delete hookData.data.solvedPid;
  }

  // Set anonymous flag if needed
  if (isAnonymous) {
    console.log("[Anonymous Posting] Setting anonymous flag for topic");
    hookData.data.anonymous = true;
    // Save anonymous flag directly to database
    await db.setObjectField(`topic:${hookData.topic.tid}`, "anonymous", true);
  }

  // If it's a question, ensure question data is saved
  if (hasQuestionData) {
    console.log("[Anonymous Posting] Saving question data for topic");
    await db.setObjectField(`topic:${hookData.topic.tid}`, "isQuestion", 1);
    await db.setObjectField(`topic:${hookData.topic.tid}`, "isSolved", 0);
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
    // Get the first post of the topic to check anonymous and question status
    const mainPid = hookData.topic.mainPid;
    if (mainPid) {
      const postData = await db.getObject(`post:${mainPid}`);
      console.log("[Anonymous Posting] Main post data:", postData);

      // Check if post is a question
      const isQuestion = postData?.isQuestion === 1;
      console.log("[Anonymous Posting] Is question:", isQuestion);

      if (isQuestion) {
        console.log("[Anonymous Posting] Setting question data on topic");
        // Set question data on topic
        await db.setObject(`topic:${hookData.topic.tid}`, {
          isQuestion: 1,
          isSolved: 0,
        });
        hookData.topic.isQuestion = 1;
        hookData.topic.isSolved = 0;
      }

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

  // Check if both anonymous and question data exist
  const hasQuestionData = hookData.data.isQuestion === true;
  const isAnonymous =
    hookData.data.anonymous === true ||
    (hookData.data.composerData &&
      hookData.data.composerData.anonymous === true);

  console.log("[Anonymous Posting] Has question data:", hasQuestionData);
  console.log("[Anonymous Posting] Is anonymous:", isAnonymous);

  if (isAnonymous) {
    console.log("[Anonymous Posting] Processing anonymous post");
    // Store the real user ID in a separate field
    const realUid = hookData.data.uid;
    console.log("[Anonymous Posting] Real user ID:", realUid);

    // Only remove Q&A data if this is not a question
    if (!hasQuestionData) {
      console.log(
        "[Anonymous Posting] Removing Q&A fields for anonymous non-question post"
      );
      delete hookData.data.isQuestion;
      delete hookData.data.isSolved;
      delete hookData.data.solvedPid;
    }

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

      // Only remove Q&A data if this is not a question
      if (!hasQuestionData) {
        await db.deleteObjectFields(`post:${pid}`, [
          "isQuestion",
          "isSolved",
          "solvedPid",
        ]);
      } else {
        // If it's a question, ensure question data is saved
        console.log("[Anonymous Posting] Saving question data for post");
        await db.setObjectField(`post:${pid}`, "isQuestion", 1);
        await db.setObjectField(`post:${pid}`, "isSolved", 0);
      }

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
  } else if (hasQuestionData) {
    // Handle non-anonymous question posts
    console.log("[Anonymous Posting] Processing non-anonymous question post");
    const pid = hookData.data.pid;
    if (pid) {
      console.log("[Anonymous Posting] Saving question data for post:", pid);
      await db.setObjectField(`post:${pid}`, "isQuestion", 1);
      await db.setObjectField(`post:${pid}`, "isSolved", 0);
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
    // Check if this is a question from the request body
    const isQuestion = hookData.caller?.req?.body?.isQuestion === true;
    console.log("[Anonymous Posting] Is question from request:", isQuestion);

    // Immediately save question data if present
    if (isQuestion) {
      console.log(
        "[Anonymous Posting] Saving question data for post:",
        hookData.post.pid
      );
      const questionData = {
        isQuestion: 1,
        isSolved: 0,
      };
      await db.setObject(`post:${hookData.post.pid}`, questionData);
      hookData.post.isQuestion = 1;
      hookData.post.isSolved = 0;
    }

    // Check if we have anonymous data stored in the hook
    if (hookData.caller.req.body.anonymous === true) {
      console.log(
        "[Anonymous Posting] Found anonymous data in hook:",
        hookData.caller.req.body
      );

      const pid = hookData.post.pid;

      // Save the anonymous data
      await db.setObject(`post:${pid}`, {
        ...hookData.caller.req.body,
        isQuestion: isQuestion ? 1 : undefined,
        isSolved: isQuestion ? 0 : undefined,
      });

      // Update the post object
      hookData.post.anonymous = true;
      hookData.post.anonymousUserId = hookData.caller.req.body.anonymousUserId;
      hookData.post.displayname = "Anonymous";
      hookData.post.uid = 0;
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
// Reusable anonymous user object
const anonymousUser = {
  username: "Anonymous",
  userslug: "anonymous",
  uid: 0,
  displayname: "Anonymous",
  picture: "",
  "icon:bgColor": "#666666",
  "icon:text": "A",
};

plugin.filterTopicGet = async function (hookData) {
  if (!hookData.topic) return hookData;

  const { uid, topic } = hookData;
  const isAdmin = await user.isAdministrator(uid);
  const isTopicAuthor = topic.uid === uid;
  const isTopicAnonymous =
    topic.anonymous === true || topic.anonymous === "true";
  console.log(
    "[Anonymous Posting] 1st condition:",
    !isAdmin && !isTopicAuthor && isTopicAnonymous
  );

  if (!isAdmin && !isTopicAuthor && isTopicAnonymous) {
    topic.uid = 0;
    topic.author = { ...anonymousUser };
  }

  if (topic.posts && topic.posts.length) {
    for (const post of topic.posts) {
      const isPostAuthor = post.uid === uid;
      const isPostAnonymous =
        post.anonymous === true || post.anonymous === "true";
      if (!isAdmin && !isPostAuthor && isPostAnonymous) {
        post.uid = 0;
        post.user = { ...anonymousUser };
      }
      // Anonymize mentions and events
      if (
        !isAdmin &&
        !isPostAuthor &&
        !isTopicAuthor &&
        isTopicAnonymous &&
        isPostAnonymous
      ) {
        post.content = anonymizeMentions(post.content);
        post.user = { ...anonymousUser };
        topic.author = { ...anonymousUser };

        // Also anonymize events if any
        if (post.events?.length) {
          for (const event of post.events) {
            console.log("----------------------->", event);

            event.user = { ...anonymousUser };
            event.text = anonymizeMentions(event.text);
          }
        }
      }

      // Handle parent post
      let isParentAnonymous = false;
      if (post.toPid) {
        const parentPost = await db.getObject(`post:${post.toPid}`);
        isParentAnonymous =
          parentPost?.anonymous === true || parentPost?.anonymous === "true";
      }

      if (
        (post.parent && isPostAnonymous) ||
        (isParentAnonymous && !isAdmin && !isPostAuthor)
      ) {
        post.toPid = "0";
        post.content = anonymizeMentions(post.content);
        post.parent = {
          username: "Anonymous",
          displayname: "Anonymous",
        };
      }
    }
  }
  if (!isAdmin && !isTopicAuthor && isTopicAnonymous) {
    topic.author = { ...anonymousUser };
  }

  return hookData;
};

function anonymizeMentions(content) {
  return (
    content
      .replace(
        /<a[^>]*href="[^"]*\/user\/[^"]+"[^>]*>[^<]+<\/a>/g,
        '<a href="/uid/0">anonymous</a>'
      )
      .replace(
        /<a[^>]*href="[^"]*\/uid\/\d+"[^>]*>@[^<]+<\/a>/g,
        '<a href="/uid/0">anonymous</a>'
      )
      .replace(
        /<a[^>]*href="[^"]*\/discussion-forum\/user\/[^"]+"[^>]*>[^<]+<\/a>/g,
        '<a href="/uid/0">anonymous</a>'
      )
      .replace(/<span[^>]*class="[^"]*avatar[^"]*"[^>]*>.*?<\/span>/g, "")
      // Remove href from links that already contain "anonymous" or point to "/uid/0"
      .replace(
        /<a[^>]*href="[^"]*\/uid\/0"[^>]*>anonymous<\/a>/g,
        '<a href="">anonymous</a>'
      )
      .replace(
        /<a[^>]*href="[^"]*"[^>]*>anonymous<\/a>/g,
        '<a href="">anonymous</a>'
      )
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
  console.log(
    "[Anonymous Posting] filterApiResponse called with path:",
    hookData.path
  );

  if (hookData.path === "/api/v3/posts/:pid/replies") {
    console.log("[Anonymous Posting] Processing replies endpoint response");
    // This will be called after filterRepliesGetV3
    if (hookData.response && Array.isArray(hookData.response)) {
      console.log(
        "[Anonymous Posting] Processing",
        hookData.response.length,
        "replies"
      );
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
