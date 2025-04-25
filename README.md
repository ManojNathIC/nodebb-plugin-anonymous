# NodeBB Anonymous Posting Plugin

[![NodeBB](https://img.shields.io/badge/NodeBB-v3.x-blue)](https://nodebb.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **Note:** 🛠️ This plugin is currently under development. Features and functionality may change, and it is not recommended for use in production environments at this time.

## Overview

The **Anonymous Posting Plugin** for NodeBB allows logged-in users to post anonymously in topics and replies. This plugin ensures that the identity of the user is hidden while still allowing moderation and administrative actions.

## Features

- Anonymous topic creation for logged-in users.
- Anonymous replies in existing topics.
- Ensures anonymity by replacing user details with "Anonymous."
- Moderators and administrators can still manage anonymous posts.
- Fully configurable via Admin Control Panel (ACP).

## Installation

1. Navigate to your NodeBB installation directory.
2. Install the plugin via npm:

   ```bash
   npm install nodebb-plugin-anonymous

   ```

3. Activate the plugin in the Admin Control Panel under Plugins.
4. Rebuild and restart your NodeBB instance:

```bash

 ./nodebb build && ./nodebb restart

```

# Hooks Used

The plugin integrates with the following NodeBB hooks:

- static:app.load: Initializes the plugin.
- filter:topic.create: Handles anonymous topic creation.
- action:topic.save: Ensures anonymous flag is saved after topic creation.
- filter:topic.get: Filters anonymous topics during retrieval.
- filter:post.create: Handles anonymous post creation.
- action:post.save: Ensures anonymous flag is saved after post creation.
- filter:post.get: Filters anonymous posts during retrieval.
- filter:composer.build: Adds anonymous posting options to the composer.

# Configuration

1. Go to the Admin Control Panel.
2. Navigate to Plugins > Anonymous Posting.
3. Configure the following options:
   - Enable/Disable anonymous posting.
   - Allow anonymous posting in specific categories.
   - Customize the display name for anonymous users.

# Usage

Anonymous Topic Creation

1. Navigate to a category.
2. Click New Topic.
3. Toggle the "Post Anonymously" option in the composer.
4. Submit the topic.
   Anonymous Replies
5. Open a topic.
6. Click Reply.
7. Toggle the "Post Anonymously" option in the composer.
8. Submit the reply.

# Contributing

Contributions are welcome! Please submit a pull request or open an issue on [GitHub](https://github.com/ManojNathIC/nodebb-plugin-anonymous).

# License

This project is licensed under the MIT License.
