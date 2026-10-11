# Playlist Index

A small React + Vite app for browsing YouTube playlists, sorting video metadata, selecting videos, and copying or exporting their URLs.

## Run locally

```sh
npm install
npm run dev
```

## YouTube Data API key

Playlist data comes from YouTube Data API v3. In the app, open **Settings** and enter an API key from a Google Cloud project with the YouTube Data API v3 enabled. Public and unlisted playlists are supported. The key is kept in the browser session and sent directly to Google from the browser.

## Build

```sh
npm run build
npm run preview
```
