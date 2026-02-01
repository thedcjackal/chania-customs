// src/api/axios.js
import axios from 'axios';
import { supabase } from '../supabase';

// Create base instance
const api = axios.create({
    baseURL: process.env.REACT_APP_API_URL || 'https://customs-api.fly.dev',
});

// REQUEST INTERCEPTOR: Attaches the token automatically
api.interceptors.request.use(async (config) => {
    // 1. Get current session from Supabase
    const { data: { session } } = await supabase.auth.getSession();

    // 2. If token exists, add it to headers
    if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
    }

    return config;
}, (error) => {
    return Promise.reject(error);
});

export default api;