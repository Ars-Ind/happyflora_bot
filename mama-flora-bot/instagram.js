const GRAPH_API_VERSION = 'v26.0';

function getInstagramToken(brand) {
  if (!brand || !brand.instagram || !brand.instagram.accessTokenEnvVar) {
    throw new Error('Не настроен accessTokenEnvVar для бренда');
  }
  const token = process.env[brand.instagram.accessTokenEnvVar];
  if (!token) {
    throw new Error(`Токен Instagram не найден в .env: ${brand.instagram.accessTokenEnvVar}`);
  }
  return token;
}

async function createMediaContainer(brand, { imageUrl, caption, isReel = false, videoUrl = null, audioId = null }) {
  const accessToken = getInstagramToken(brand);
  const igUserId = brand.instagram.userId;

  const params = new URLSearchParams({ caption, access_token: accessToken });

  if (isReel && videoUrl) {
    params.append('media_type', 'REELS');
    params.append('video_url', videoUrl);
    if (audioId) {
      params.append('audio_configuration', JSON.stringify({ audio_id: audioId }));
    }
  } else {
    params.append('media_type', 'IMAGE');
    params.append('image_url', imageUrl);
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?${params.toString()}`,
    { method: 'POST' }
  );
  const data = await response.json();
  if (data.error) {
    console.error('Полная ошибка создания контейнера от Meta:', JSON.stringify(data.error));
    throw new Error(`Ошибка создания контейнера: ${data.error.message}`);
  }
  return data.id;
}

// Поиск музыки/звуков Instagram для Reels. Без searchQuery — вернёт трендовые треки.
async function searchAudio(brand, { audioType = 'music', searchQuery } = {}) {
  const accessToken = getInstagramToken(brand);
  const igUserId = brand.instagram.userId;
  const params = new URLSearchParams({ audio_type: audioType, user_id: igUserId, access_token: accessToken });
  if (searchQuery) params.append('search_query', searchQuery);

  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/ig_audio?${params.toString()}`);
  const data = await response.json();
  if (data.error) {
    console.error('Ошибка поиска аудио:', JSON.stringify(data.error));
    return [];
  }
  return data.data || [];
}

async function checkContainerStatus(brand, containerId) {
  const accessToken = getInstagramToken(brand);
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${containerId}?fields=status_code&access_token=${accessToken}`
  );
  const data = await response.json();
  return data.status_code;
}

async function waitForContainerReady(brand, containerId, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await checkContainerStatus(brand, containerId);
    if (status === 'FINISHED') return true;
    if (status === 'ERROR') throw new Error('Instagram сообщил об ошибке обработки медиа');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Превышено время ожидания готовности медиа');
}

async function publishContainer(brand, containerId) {
  const accessToken = getInstagramToken(brand);
  const igUserId = brand.instagram.userId;
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media_publish?creation_id=${containerId}&access_token=${accessToken}`,
    { method: 'POST' }
  );
  const data = await response.json();
  if (data.error) throw new Error(`Ошибка публикации: ${data.error.message}`);
  return data.id;
}

async function getPostPermalink(brand, mediaId) {
  const accessToken = getInstagramToken(brand);
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}?fields=permalink&access_token=${accessToken}`
  );
  const data = await response.json();
  if (data.error) throw new Error(`Ошибка получения ссылки: ${data.error.message}`);
  return data.permalink;
}

async function publishPhoto(brand, { imageUrl, caption }) {
  const containerId = await createMediaContainer(brand, { imageUrl, caption });
  await waitForContainerReady(brand, containerId);
  const mediaId = await publishContainer(brand, containerId);
  const permalink = await getPostPermalink(brand, mediaId);
  return { mediaId, permalink };
}

async function createCarouselItemContainer(brand, imageUrl) {
  const accessToken = getInstagramToken(brand);
  const igUserId = brand.instagram.userId;
  const params = new URLSearchParams({ image_url: imageUrl, is_carousel_item: 'true', access_token: accessToken });
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?${params.toString()}`,
    { method: 'POST' }
  );
  const data = await response.json();
  if (data.error) throw new Error(`Ошибка создания элемента карусели: ${data.error.message}`);
  return data.id;
}

async function publishCarousel(brand, { imageUrls, caption }) {
  if (!imageUrls || imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error('Для карусели нужно от 2 до 10 фото');
  }
  const accessToken = getInstagramToken(brand);
  const igUserId = brand.instagram.userId;

  const childIds = [];
  for (const url of imageUrls) {
    // eslint-disable-next-line no-await-in-loop
    const id = await createCarouselItemContainer(brand, url);
    childIds.push(id);
  }

  const params = new URLSearchParams({
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
    access_token: accessToken
  });
  const containerResponse = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?${params.toString()}`,
    { method: 'POST' }
  );
  const containerData = await containerResponse.json();
  if (containerData.error) throw new Error(`Ошибка создания карусели: ${containerData.error.message}`);

  await waitForContainerReady(brand, containerData.id);
  const mediaId = await publishContainer(brand, containerData.id);
  const permalink = await getPostPermalink(brand, mediaId);
  return { mediaId, permalink };
}

async function publishReel(brand, { videoUrl, caption, audioId = null }) {
  const containerId = await createMediaContainer(brand, { caption, isReel: true, videoUrl, audioId });
  await waitForContainerReady(brand, containerId, 180000);
  const mediaId = await publishContainer(brand, containerId);
  const permalink = await getPostPermalink(brand, mediaId);
  return { mediaId, permalink };
}

async function createStoryContainer(brand, { imageUrl, videoUrl }) {
  const accessToken = getInstagramToken(brand);
  const igUserId = brand.instagram.userId;
  const params = new URLSearchParams({ media_type: 'STORIES', access_token: accessToken });
  if (videoUrl) {
    params.append('video_url', videoUrl);
  } else if (imageUrl) {
    params.append('image_url', imageUrl);
  } else {
    throw new Error('Нужно передать imageUrl или videoUrl для истории');
  }
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?${params.toString()}`,
    { method: 'POST' }
  );
  const data = await response.json();
  if (data.error) throw new Error(`Ошибка создания истории: ${data.error.message}`);
  return data.id;
}

async function publishStory(brand, { imageUrl, videoUrl }) {
  const containerId = await createStoryContainer(brand, { imageUrl, videoUrl });
  await waitForContainerReady(brand, containerId, videoUrl ? 180000 : 60000);
  const mediaId = await publishContainer(brand, containerId);
  return { mediaId };
}

async function getAccountInsights(brand) {
  const accessToken = getInstagramToken(brand);
  const igUserId = brand.instagram.userId;
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}?fields=followers_count,media_count&access_token=${accessToken}`
  );
  const data = await response.json();
  if (data.error) throw new Error(`Ошибка получения данных аккаунта: ${data.error.message}`);
  return { followersCount: data.followers_count, mediaCount: data.media_count };
}

async function getRecentMediaWithInsights(brand, limit = 5) {
  const accessToken = getInstagramToken(brand);
  const igUserId = brand.instagram.userId;
  const listResponse = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?fields=id,caption,timestamp,permalink,media_type&limit=${limit}&access_token=${accessToken}`
  );
  const listData = await listResponse.json();
  if (listData.error) throw new Error(`Ошибка получения списка постов: ${listData.error.message}`);

  const items = listData.data || [];
  const withInsights = await Promise.all(
    items.map(async (item) => {
      try {
        const metricNames = item.media_type === 'VIDEO'
          ? 'reach,likes,comments,saved,plays'
          : 'reach,likes,comments,saved';
        const insightsResponse = await fetch(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${item.id}/insights?metric=${metricNames}&access_token=${accessToken}`
        );
        const insightsData = await insightsResponse.json();
        const metrics = {};
        if (insightsData.data) {
          insightsData.data.forEach((metric) => {
            metrics[metric.name] = metric.values?.[0]?.value ?? 0;
          });
        }
        return { ...item, metrics };
      } catch (err) {
        return { ...item, metrics: {}, insightsError: err.message };
      }
    })
  );
  return withInsights;
}

module.exports = {
  publishPhoto,
  publishCarousel,
  publishReel,
  publishStory,
  getAccountInsights,
  getRecentMediaWithInsights,
  searchAudio
};
