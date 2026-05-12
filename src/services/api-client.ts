import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import { config } from '../config';
import { LoginResponse } from '../types/thingsboard';

const cache = new NodeCache({ stdTTL: 3000 }); // JWT typically valid for longer, but 50 mins is safe
const AUTH_TOKEN_KEY = 'auth_token';

class ApiClient {
  private axiosInstance: AxiosInstance;
  private loginPromise: Promise<string> | null = null;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.axiosInstance.interceptors.request.use(async (axiosConfig: InternalAxiosRequestConfig) => {
      if (axiosConfig.url === '/api/auth/login') {
        return axiosConfig;
      }

      const token = await this.getToken();
      if (token && axiosConfig.headers) {
        axiosConfig.headers['X-Authorization'] = `Bearer ${token}`;
      }
      return axiosConfig;
    });
  }

  private async getToken(): Promise<string | undefined> {
    const token = cache.get<string>(AUTH_TOKEN_KEY);
    if (token) {
      return token;
    }

    // Synchronize multiple login attempts
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  private async login(): Promise<string> {
    try {
      console.log('Logging in to ThingsBoard...');
      const response = await axios.post<LoginResponse>(`${config.baseUrl}/api/auth/login`, {
        username: config.username,
        password: config.password,
      });

      const token = response.data.token;
      cache.set(AUTH_TOKEN_KEY, token);
      return token;
    } catch (error) {
      throw new Error(`Authentication failed: ${formatAxiosError(error)}`);
    }
  }

  public get instance(): AxiosInstance {
    return this.axiosInstance;
  }
}

export function formatAxiosError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  const axiosError = error as AxiosError;
  const status = axiosError.response?.status;
  const statusText = axiosError.response?.statusText;
  const responseData = axiosError.response?.data;

  if (status) {
    const responseDetails =
      typeof responseData === 'string' ? responseData : responseData ? JSON.stringify(responseData) : 'No response body';
    return `${status} ${statusText || ''}`.trim() + ` - ${responseDetails}`;
  }

  return axiosError.message;
}

export const apiClient = new ApiClient().instance;
