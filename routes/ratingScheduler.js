const axios = require('axios');

function startRatingScheduler() {
  console.log('✅ Rating scheduler started.');

  setInterval(async () => {
    try {
      console.log('🔄 Triggering player ratings calculation...');
      const response = await axios.get('https://cricket-scoreboard-backend.onrender.com/api/ratings/calculate');
      console.log('✅ Ratings updated:', response.data.message);
    } catch (error) {
      console.error('❌ Failed to update ratings:', error.message);
    }
  }, 5000); // every 5 sec
}

module.exports = { startRatingScheduler };
