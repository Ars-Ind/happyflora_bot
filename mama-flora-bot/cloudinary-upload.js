const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

function assertConfigured() {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Не заданы переменные CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET в .env');
  }
}

// Готовые форматы под Instagram: лента/карусель — 4:5, Reels/Stories — 9:16 (во весь экран)
const FORMATS = {
  feed: { width: 1080, height: 1350 },
  full: { width: 1080, height: 1920 }
};

async function uploadImageAndGetPublicUrl(base64Data, mimetype, format = 'feed') {
  assertConfigured();
  const mime = mimetype || 'image/jpeg';
  const dataUri = `data:${mime};base64,${base64Data}`;
  const { width, height } = FORMATS[format] || FORMATS.feed;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: 'mama-flora-bot',
    resource_type: 'image',
    transformation: [{ width, height, crop: 'fill', gravity: 'auto' }]
  });
  return result.secure_url;
}

async function uploadVideoAndGetPublicUrl(base64Data, mimetype, format = 'full', { muteAudio = false } = {}) {
  assertConfigured();
  const mime = mimetype || 'video/mp4';
  const dataUri = `data:${mime};base64,${base64Data}`;
  const { width, height } = FORMATS[format] || FORMATS.full;

  const transformation = { width, height, crop: 'fill', gravity: 'auto' };
  if (muteAudio) transformation.audio_codec = 'none';

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: 'mama-flora-bot',
    resource_type: 'video',
    transformation: [transformation]
  });
  return result.secure_url;
}

module.exports = { uploadImageAndGetPublicUrl, uploadVideoAndGetPublicUrl };
