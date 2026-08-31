# AI Web Chat App   new

A lightweight real-time messaging app built with Node.js, Express, Socket.IO, and MongoDB. Users can sign up with an email, password, and a unique 4-digit code, then start private conversations with other users by entering their code.

Live demo: https://web-chat-app-vlv2.onrender.com

## Project Overview

This project combines a simple web front end with a real-time backend so users can:
- create an account and sign in
- discover other users by their 4-digit code
- open a private 1-to-1 chat
- send text and image messages
- react to messages
- receive real-time typing and message updates

## Main Features

- User signup and login with email, password, and a unique 4-digit code
- Private 1-to-1 messaging with real-time updates
- Image sharing inside chat conversations
- Message reactions for quick responses
- Connection panel for finding and managing chat partners

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js + Express
- Real-time communication: Socket.IO
- Database: MongoDB via Mongoose
- Authentication: bcrypt

## Project Dependencies

Core dependencies used by the project:
- express
- socket.io
- mongoose
- dotenv
- bcrypt
- cors
- body-parser
- pg
- nodemon (development)

## Project Structure

- [server.js](server.js) — Express server, API routes, Socket.IO events, and MongoDB models
- [public/index.html](public/index.html) — app UI layout
- [public/app.js](public/app.js) — client-side logic for auth, chat, reactions, and sockets
- [public/style.css](public/style.css) — styling for the app
- [package.json](package.json) — scripts and dependencies

## Prerequisites

Before running locally, make sure you have:
- Node.js 20 or newer
- MongoDB running locally, or a MongoDB Atlas connection string

## Local Setup

1. Open a terminal in the project directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a environment file named `.env` in the project root:
   ```env
   MONGODB_URI=mongodb://127.0.0.1:27017/web_chat_app_upgraded
   PORT=3000
   ```
   If you are using MongoDB Atlas, replace the URI with your connection string.
4. Start the server:
   ```bash
   npm start
   ```
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```
5. Open your browser at:
   ```text
   http://localhost:3000
   ```

## How to Use the App

1. Create an account with:
   - an email address
   - a password
   - a unique 4-digit code
2. Open the app in another browser/tab or another device and create a second account.
3. Sign in with one account and use the other account's 4-digit code to open a chat.
4. Send messages, attach images, and use reactions.
5. Use the connection panel to manage recent conversations.

## API Overview

The app exposes a few simple REST endpoints:

- `POST /api/signup` — create a user account
- `POST /api/login` — sign in with email and password
- `GET /api/user/:code` — look up a user by 4-digit code
- `GET /api/messages/:chatId/:userId` — fetch chat history
- `POST /api/messages/read` — mark messages as read
- `DELETE /api/messages` — delete messages in bulk

## Deployment

### Render

1. Push the project to GitHub.
2. Create a new Web Service on Render.
3. Connect the repository and use these settings:
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Add environment variable: `NODE_ENV=production`
   - Add your MongoDB connection string as `MONGODB_URI`
4. Deploy the service and visit the generated public URL.

> Note: the free Render tier may sleep after inactivity. A MongoDB Atlas instance is recommended for production deployments.

## Notes

- The app uses MongoDB by default, not SQLite.
- If MongoDB is unavailable, the server will still start, but database-backed requests will return a 503 error until the connection is restored.
- The project is intended as a demo / personal messaging app and can be extended with better authentication, moderation, and persistence features.
