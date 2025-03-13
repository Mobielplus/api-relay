// index.js - Express server for handling Meta webhooks and forwarding to Retool

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Your configurations
const VERIFY_TOKEN = "YOUR_CUSTOM_VERIFY_TOKEN"; // Create a random string for this
const RETOOL_WEBHOOK_URL = "https://api.retool.com/v1/workflows/7b9529d0-06ef-4d1c-846b-d78c395a4e0a/startTrigger";
const RETOOL_API_KEY = "retool_wk_0d7378044d434840857179562bd33a09";

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
      
      console.log('Forwarded to Retool, response:', response.status);
      
      // Return a '200 OK' response to acknowledge receipt of the event
      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('Error forwarding to Retool:', error.message);
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

// Listen for requests
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// For Vercel serverless deployment
module.exports = app;