export default {
  async uploadImage(uri, options) {
    return { success: true, url: 'https://up.doz.com/s/test123' };
  },
  async updateUsage(userId) {
    console.log('Usage updated for', userId);
  },
};
