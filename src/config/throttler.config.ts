export const throttlerConfig = {
  throttlers: [
    {
      ttl: 60000, // 1 minute
      limit: 100, // 10 requests per minute
    },
  ],
};
