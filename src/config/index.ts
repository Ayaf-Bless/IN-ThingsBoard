import dotenv from 'dotenv';
dotenv.config();

function normalizeBaseUrl(rawBaseUrl: string): string {
  try {
    const url = new URL(rawBaseUrl);
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new Error(
      `Invalid THINGSBOARD_BASE_URL: "${rawBaseUrl}". Expected a full URL such as "https://webapp02.heatmanager.cloud".`
    );
  }
}

export const config = {
  baseUrl: normalizeBaseUrl(process.env.THINGSBOARD_BASE_URL || 'https://webapp02.heatmanager.cloud'),
  username: process.env.THINGSBOARD_USERNAME || '',
  password: process.env.THINGSBOARD_PASSWORD || '',
  pageSize: Number(process.env.THINGSBOARD_PAGE_SIZE || 100),
  relationConcurrency: Number(process.env.THINGSBOARD_RELATION_CONCURRENCY || 10),
};

if (!config.username || !config.password) {
  console.warn('Warning: THINGSBOARD_USERNAME or THINGSBOARD_PASSWORD not set in environment variables.');
}
