export default {
  async initialize() {
    console.log('Analytics initialized');
  },
  logEvent(event, data) {
    console.log('Analytics:', event, data);
  },
};
