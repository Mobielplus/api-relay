// index.js - Express server for handling Meta webhooks and forwarding to Retool

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();

// Configure body-parser to handle various content types and increase size limits
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.text({ limit: '10mb' }));
app.use(bodyParser.raw({ limit: '10mb' }));

// Add comprehensive request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const requestId = Math.random().toString(36).substring(2, 15);
  
  console.log(`===== REQUEST ${requestId} START =====`);
  console.log(`[${timestamp}] ${req.method} ${req.url} from ${req.ip}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  // Log request body if present
  if (req.body) {
    if (typeof req.body === 'object') {
      console.log('Body:', JSON.stringify(req.body, null, 2));
    } else {
      console.log('Body (non-JSON):', req.body);
    }
  } else {
    console.log('Body: Empty or not parsed');
  }
  
  // Log query parameters if present
  if (Object.keys(req.query).length > 0) {
    console.log('Query params:', JSON.stringify(req.query, null, 2));
  }
  
  // Track response
  const originalSend = res.send;
  res.send = function(body) {
    console.log(`Response ${requestId} status:`, res.statusCode);
    console.log(`Response ${requestId} body:`, body);
    console.log(`===== REQUEST ${requestId} END =====`);
    return originalSend.call(this, body);
  };
  
  next();
});

// Get configurations from environment variables
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const RETOOL_WEBHOOK_URL = process.env.RETOOL_WEBHOOK_URL;
const RETOOL_API_KEY = process.env.RETOOL_API_KEY;

// Handle GET requests for Meta webhook verification
app.get('/api/webhook', (req, res) => {
  console.log('Processing verification request...');
  
  // Parse the query params
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Verification details:', {
    mode: mode,
    token: token ? '**redacted**' : undefined,
    challenge: challenge,
    expectedToken: VERIFY_TOKEN ? '**configured**' : '**missing**'
  });

  // Check if a token and mode is in the query string of the request
  if (mode && token) {
    // Check the mode and token sent are correct
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      // Respond with the challenge token from the request
      console.log('WEBHOOK_VERIFIED - Sending challenge response');
      res.status(200).send(challenge);
    } else {
      console.log('WEBHOOK_VERIFICATION_FAILED - Token mismatch or invalid mode');
      // Respond with '403 Forbidden' if verify tokens do not match
      res.status(403).send('Verification failed');
    }
  } else {
    console.log('WEBHOOK_VERIFICATION_FAILED - Missing mode or token');
    // Return a '404 Not Found' if mode or token are missing
    res.status(404).send('Missing verification parameters');
  }
});

// Handle POST requests (actual webhook events)
app.post('/api/webhook', async (req, res) => {
  console.log('Processing webhook event...');
  
  const body = req.body;
  
  // Additional check for empty body
  if (!body) {
    console.error('ERROR: Empty request body');
    return res.status(400).send('INVALID_REQUEST_BODY');
  }
  
  // Add specific logging for WhatsApp message format
  if (body.entry && body.entry.length > 0) {
    console.log(`Webhook contains ${body.entry.length} entries`);
    
    for (let i = 0; i < body.entry.length; i++) {
      const entry = body.entry[i];
      console.log(`Entry ${i} ID: ${entry.id}`);
      
      if (entry.changes && entry.changes.length > 0) {
        console.log(`Entry ${i} has ${entry.changes.length} changes`);
        
        for (let j = 0; j < entry.changes.length; j++) {
          const change = entry.changes[j];
          console.log(`Change ${j} field: ${change.field}`);
          
          if (change.value && change.value.messaging_product === 'whatsapp') {
            console.log('WhatsApp message detected!');
            
            if (change.value.messages && change.value.messages.length > 0) {
              console.log(`Contains ${change.value.messages.length} messages`);
              change.value.messages.forEach((msg, idx) => {
                console.log(`Message ${idx} type: ${msg.type}`);
              });
            }
          }
        }
      }
    }
  }

  // Check if this is an event from a page subscription
  if (body.object) {
    console.log(`Processing event of type: ${body.object}`);
    
    try {
      // Check if required environment variables are configured
      if (!RETOOL_API_KEY) {
        console.error('ERROR: RETOOL_API_KEY is not configured');
        return res.status(500).send('SERVER_CONFIGURATION_ERROR');
      }
      
      if (!RETOOL_WEBHOOK_URL) {
        console.error('ERROR: RETOOL_WEBHOOK_URL is not configured');
        return res.status(500).send('SERVER_CONFIGURATION_ERROR');
      }

      console.log('Forwarding to Retool at:', RETOOL_WEBHOOK_URL.replace(/\/[^/]+$/, '/***'));
      
      // Forward the webhook payload to Retool
      const response = await axios.post(
        RETOOL_WEBHOOK_URL,
        body, // Forward the entire payload from Meta
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Workflow-Api-Key': RETOOL_API_KEY
          },
          // Add timeout to prevent hanging requests
          timeout: 10000
        }
      );
      
      // Log the complete response from Retool
      console.log('SUCCESS: Retool forwarding completed');
      console.log('Retool response status:', response.status);
      console.log('Retool response headers:', JSON.stringify(response.headers));
      console.log('Retool response data:', JSON.stringify(response.data));
      
      // Return a '200 OK' response to acknowledge receipt of the event
      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('================ ERROR FORWARDING TO RETOOL ================');
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      if (error.response) {
        // Log the error response from Retool
        console.error('Retool error status:', error.response.status);
        console.error('Retool error data:', JSON.stringify(error.response.data));
      } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received from Retool (timeout or network issue)');
      }
      
      // Still return 200 to Meta so they don't retry (which could cause duplicate events)
      res.status(200).send('EVENT_RECEIVED_BUT_PROCESSING_FAILED');
    }
  } else {
    console.error('INVALID_REQUEST: Missing "object" property in webhook payload');
    // Log that we're still returning 200 to prevent retries
    console.log('Returning 200 anyway to prevent retries');
    res.status(200).send('INVALID_EVENT_BUT_ACKNOWLEDGED');
  }
});

// Default route with enhanced info
app.get('/', (req, res) => {
  const info = {
    name: 'Meta to Retool Webhook Middleware',
    status: 'running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    config: {
      verifyToken: VERIFY_TOKEN ? 'configured' : 'missing',
      retoolWebhook: RETOOL_WEBHOOK_URL ? 'configured' : 'missing',
      retoolApiKey: RETOOL_API_KEY ? 'configured' : 'missing'
    }
  };
  
  console.log('Health check accessed:', info);
  res.send(`<h1>${info.name}</h1>
<p>Status: ${info.status}</p>
<p>Timestamp: ${info.timestamp}</p>
<p>Environment: ${info.environment}</p>
<h2>Configuration:</h2>
<ul>
  <li>Verify Token: ${info.config.verifyToken}</li>
  <li>Retool Webhook: ${info.config.retoolWebhook}</li>
  <li>Retool API Key: ${info.config.retoolApiKey}</li>
</ul>`);
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Webhook URL: http://localhost:${PORT}/api/webhook`);
    console.log('Environment variables status:');
    console.log(`- VERIFY_TOKEN: ${VERIFY_TOKEN ? 'configured' : 'missing'}`);
    console.log(`- RETOOL_WEBHOOK_URL: ${RETOOL_WEBHOOK_URL ? 'configured' : 'missing'}`);
    console.log(`- RETOOL_API_KEY: ${RETOOL_API_KEY ? 'configured' : 'missing'}`);
  });
}

// For Vercel serverless deployment
module.exports = app;