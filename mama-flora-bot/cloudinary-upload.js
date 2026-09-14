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

async function uploadImageAndGetPublicUrl(base64Data, mimetype) {
  assertConfigured();
  const mime = mimetype || 'image/jpeg';
  const dataUri = `data:${mime};base64,${base64Data}`;
  const result = await cloudinary.uploader.upload(dataUri, { folder: 'mama-flora-bot', resource_type: 'image' });
  return result.secure_url;
}

async function uploadVideoAndGetPublicUrl(base64Data, mimetype) {
  assertConfigured();
  const mime = mimetype || 'video/mp4';
  const dataUri = `data:${mime};base64,${base64Data}`;
  const result = await cloudinary.uploader.upload(dataUri, { folder: 'mama-flora-bot', resource_type: 'video' });
  return result.secure_url;
}

module.exports = { uploadImageAndGetPublicUrl, uploadVideoAndGetPublicUrl };
