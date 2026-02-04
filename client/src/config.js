
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

export const API_URL = isLocal 
    ? 'http://localhost:5000/api'  // Local Development URL
    : 'https://customs-api.fly.dev/api'; // Production URL