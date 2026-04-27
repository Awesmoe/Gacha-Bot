const config = require('./config');
const api = require('./api');
const format = require('./format');

module.exports = {
  ...config,
  api,
  format,
};
