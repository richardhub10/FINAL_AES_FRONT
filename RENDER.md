# Deploying the Frontend to Render

Create a **Static Site** on Render from this repo.

Settings:
- Build command: `npm ci && npm run build`
- Publish directory: `dist`

Notes:
- This uses Expo web export (`expo export -p web`).
- The backend URL is fixed in code. To change it for a deployment, set a Render environment variable:
	- `EXPO_PUBLIC_API_BASE_URL` (example: `https://your-backend.onrender.com`)

Branding:
- To show the University logo in the header, set:
	- `EXPO_PUBLIC_UA_LOGO_URI` (example: `https://.../ua-logo.png`)
	- If not set, the app shows a simple `UA` fallback block.
