const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'https://marketing-studio-gold.vercel.app'],
}));
app.use(express.json());

let ai;
function getAI() {
  if (!ai) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY non configurata');
    }
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

// Style presets
const styleMap = {
  cinematico: 'cinematic look, shallow depth of field, film grain, anamorphic lens',
  documentary: 'documentary style, natural lighting, handheld camera, authentic feel',
  commercial: 'commercial production quality, clean lighting, polished look, vibrant colors',
  artistico: 'artistic cinematography, creative angles, dramatic lighting, visual poetry',
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'video-worker', timestamp: new Date().toISOString() });
});

// POST /generate - Start video generation
app.post('/generate', async (req, res) => {
  try {
    const { prompt, style = 'cinematico', aspectRatio = '16:9' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt richiesto' });
    }

    const styleHint = styleMap[style] || styleMap.cinematico;
    const fullPrompt = `${prompt}. Style: ${styleHint}`;

    console.log(`[generate] Starting video generation: "${prompt.substring(0, 80)}..." style=${style} aspect=${aspectRatio}`);

    const operation = await getAI().models.generateVideos({
      model: 'veo-3.1-generate-preview',
      prompt: fullPrompt,
      config: {
        aspectRatio,
        numberOfVideos: 1,
      },
    });

    const operationName = operation.name;
    console.log(`[generate] Operation started: ${operationName}`);

    res.json({ operationName, status: 'processing' });
  } catch (err) {
    console.error('[generate] Error:', err.message);
    res.status(500).json({ error: err.message || 'Errore generazione video' });
  }
});

// GET /status?op=<operationName> - Poll video generation status
app.get('/status', async (req, res) => {
  try {
    const operationName = req.query.op;

    if (!operationName) {
      return res.status(400).json({ error: 'operationName richiesto (param: op)' });
    }

    const operation = await getAI().operations.get({ operation: operationName });

    if (!operation.done) {
      return res.json({ status: 'processing' });
    }

    // Operation complete
    const result = operation.response;

    if (result?.generatedVideos?.length > 0) {
      const video = result.generatedVideos[0];
      if (video.video?.uri) {
        console.log(`[status] Video ready: ${operationName}`);
        return res.json({ status: 'done', videoUrl: video.video.uri });
      }
    }

    // No video in result - check for errors
    if (operation.error) {
      console.error(`[status] Operation error:`, operation.error);
      return res.json({ status: 'error', error: operation.error.message || 'Errore nella generazione' });
    }

    // Done but no video - dump raw response for debugging
    console.warn(`[status] Done but no video. Raw:`, JSON.stringify(operation).substring(0, 500));
    res.json({
      status: 'done',
      videoUrl: null,
      raw: JSON.stringify(operation).substring(0, 300),
    });
  } catch (err) {
    console.error('[status] Error:', err.message);
    res.status(500).json({ error: err.message || 'Errore verifica stato' });
  }
});

app.listen(PORT, () => {
  console.log(`Video worker running on port ${PORT}`);
});
