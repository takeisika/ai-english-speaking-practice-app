// metro.config.js (プロジェクトのルートに配置)
const { getDefaultConfig } = require('@expo/metro-config');

const config = getDefaultConfig(__dirname);

// もし追加の設定があれば追記
module.exports = config;