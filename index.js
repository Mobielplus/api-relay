// index.js - Express server for handling Meta webhooks and forwarding to Retool

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Add request logging middleware - logs every request to any endpoint (with simplified output)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} request to ${req.url} from ${req.ip}`);
  
  // For POST requests, log the body
  if (req.method === 'POST' && req.body) {
    console.log('Body:', JSON.stringify(req.body));
  }
  
  // For GET requests, log the query parameters
  if (req.method === 'GET' && Object.keys(req.query).length > 0) {
    console.log('Query params:', JSON.stringify(req.query));
  }
  
  next();
});

// Get configurations from environment variables
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const RETOOL_WEBHOOK_URL = process.env.RETOOL_WEBHOOK_URL;
const RETOOL_API_KEY = process.env.RETOOL_API_KEY;

// Handle GET requests for Meta webhook verification
app.get('/api/webhook', (req, res) => {
  console.log('Received verification request:', req.query);
  
  // Parse the query params
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check if a token and mode is in the query string of the request
  if (mode && token) {
    // Check the mode and token sent are correct
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      // Respond with the challenge token from the request
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      // Respond with '403 Forbidden' if verify tokens do not match
      res.sendStatus(403);
    }
  } else {
    // Return a '404 Not Found' if mode or token are missing
    res.sendStatus(404);
  }
});

// Handle POST requests (actual webhook events)
app.post('/api/webhook', async (req, res) => {
  const body = req.body;
  console.log('Received webhook event:', JSON.stringify(body));

  // Check if this is an event from a page subscription
  if (body.object) {
    try {
      // Check if required environment variables are configured
      if (!RETOOL_API_KEY) {
        console.error('RETOOL_API_KEY is not configured');
        return res.status(500).send('SERVER_CONFIGURATION_ERROR');
      }
      
      if (!RETOOL_WEBHOOK_URL) {
        console.error('RETOOL_WEBHOOK_URL is not configured');
        return res.status(500).send('SERVER_CONFIGURATION_ERROR');
      }

      // Forward the webhook payload to Retool
      const response = await axios.post(
        RETOOL_WEBHOOK_URL,
        body, // Forward the entire payload from Meta
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Workflow-Api-Key': RETOOL_API_KEY
          }
        }
      );
      
      // Log the complete response from Retool
      console.log('Retool response status:', response.status);
      console.log('Retool response headers:', JSON.stringify(response.headers));
      console.log('Retool response data:', JSON.stringify(response.data));
      
      // Return a '200 OK' response to acknowledge receipt of the event
      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('Error forwarding to Retool:', error.message);
      if (error.response) {
        // Log the error response from Retool
        console.error('Retool error status:', error.response.status);
        console.error('Retool error data:', JSON.stringify(error.response.data));
      }
      // Still return 200 to Meta so they don't retry (which could cause duplicate events)
      res.status(200).send('EVENT_RECEIVED_BUT_PROCESSING_FAILED');
    }
  } else {
    // Return a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }
});

// Default route
app.get('/', (req, res) => {
  res.send('Meta to Retool Webhook Middleware is running!');
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// For Vercel serverless deployment
module.exports = app;