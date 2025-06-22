require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const bodyParser = require("body-parser");
const Razorpay = require("razorpay"); // Add Razorpay SDK
const crypto = require("crypto"); // For payment verification
const axios = require("axios"); // Import axios for Shiprocket API

// Handle fetch import based on Node.js version
let fetch;
try {
  // For Node.js >= 18 (with built-in fetch)
  if (!globalThis.fetch) {
    fetch = require("node-fetch");
  } else {
    fetch = globalThis.fetch;
  }
} catch (error) {
  console.error("Error importing fetch:", error);
  // Fallback to node-fetch
  fetch = require("node-fetch");
}

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: [
    'https://agent-sigma-livid.vercel.app',
    'https://sacredrelm.com',
    'https://myiandi.com',
    'https://vlog-camera.vercel.app',
    'https://glowglazecommerce.vercel.app', // Fixed: removed trailing slash and added this domain correctly
    'https://beyondslim.in',
    'https://glowglaz.com',
    'https://glowglaz-vert.vercel.app',
    'https://drjoints.in',
    'https://drjoints.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Add credentials support for cookies/auth headers if needed
}));
app.use(bodyParser.json());

// Razorpay Configuration
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Nodemailer Configuration

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Shiprocket API Integration
let shiprocketToken = null;
let tokenExpiryTime = null;

// Function to get Shiprocket token (with caching)
async function getShiprocketToken() {
  // Check if we have a valid cached token
  const currentTime = new Date();
  if (shiprocketToken && tokenExpiryTime && currentTime < tokenExpiryTime) {
    console.log("Using cached Shiprocket token");
    return shiprocketToken;
  }
  
  try {
    console.log("Fetching new Shiprocket token");
    const response = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD
      })
    });
    
    const data = await response.json();
    
    if (data.token) {
      shiprocketToken = data.token;
      // Set token expiry time (typically 24 hours for Shiprocket)
      tokenExpiryTime = new Date();
      tokenExpiryTime.setHours(tokenExpiryTime.getHours() + 23); // Set expiry to 23 hours to be safe
      return shiprocketToken;
    } else {
      throw new Error(data.message || "Failed to authenticate with Shiprocket");
    }
  } catch (error) {
    console.error("Shiprocket authentication error:", error);
    throw error;
  }
}

// Shiprocket Authentication Test Endpoint
app.get("/shiprocket/test-auth", async (req, res) => {
  try {
    const token = await getShiprocketToken();
    res.status(200).json({
      success: true,
      message: "Shiprocket authentication successful",
      tokenExpiresAt: tokenExpiryTime,
      token: token // Include the token in the response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Shiprocket authentication failed",
      error: error.message
    });
  }
});

// Create Shiprocket Order
app.post("/shiprocket/create-order", async (req, res) => {
  try {
    const token = await getShiprocketToken();
    const orderData = req.body;
    
    // Validate required fields
    if (!orderData.order_id || !orderData.order_date || !orderData.pickup_location || 
        !orderData.billing_customer_name || !orderData.billing_address || 
        !orderData.billing_city || !orderData.billing_pincode || !orderData.billing_state || 
        !orderData.billing_country || !orderData.billing_email || !orderData.billing_phone || 
        !orderData.order_items || orderData.order_items.length === 0) {
      
      // Send email notification about missing order information
      await sendShiprocketFailureEmail(
        "Shiprocket Order Creation Failed - Missing Data", 
        `Failed to create Shiprocket order due to missing required information.\n\nOrder ID: ${orderData.order_id || 'N/A'}\n\nCustomer: ${orderData.billing_customer_name || 'N/A'}\n\nError: Missing required order information`,
        orderData
      );
      
      return res.status(400).json({
        success: false,
        message: "Missing required order information"
      });
    }

    const response = await fetch("https://apiv2.shiprocket.in/v1/external/orders/create/adhoc", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(orderData)
    });
    
    const data = await response.json();
    
    if (response.ok) {
      res.status(200).json({
        success: true,
        message: "Order created successfully on Shiprocket",
        data
      });
    } else {
      // Send email notification about the API error
      await sendShiprocketFailureEmail(
        "Shiprocket Order Creation Failed - API Error", 
        `Failed to create Shiprocket order due to API error.\n\nOrder ID: ${orderData.order_id}\n\nCustomer: ${orderData.billing_customer_name}\n\nError: ${JSON.stringify(data)}`,
        orderData
      );
      
      res.status(response.status).json({
        success: false,
        message: "Failed to create order on Shiprocket",
        error: data
      });
    }
  } catch (error) {
    console.error("Error creating Shiprocket order:", error);
    
    // Get order data if available, or empty object if not
    const orderData = req.body || {};
    
    // Send email notification about the exception
    await sendShiprocketFailureEmail(
      "Shiprocket Order Creation Failed - Exception", 
      `Failed to create Shiprocket order due to an exception.\n\nOrder ID: ${orderData.order_id || 'N/A'}\n\nCustomer: ${orderData.billing_customer_name || 'N/A'}\n\nError: ${error.message || error}`,
      orderData
    );
    
    res.status(500).json({
      success: false,
      message: "Error creating Shiprocket order",
      error: error.message
    });
  }
});

// Helper function to send Shiprocket failure email notifications
async function sendShiprocketFailureEmail(subject, textMessage, orderData) {
  try {
    // Format customer and order details
    const customerDetails = orderData ? `
      Customer Name: ${orderData.billing_customer_name || 'N/A'}
      Email: ${orderData.billing_email || 'N/A'}
      Phone: ${orderData.billing_phone || 'N/A'}
      Address: ${orderData.billing_address || 'N/A'}
      City: ${orderData.billing_city || 'N/A'}
      State: ${orderData.billing_state || 'N/A'}
      Pincode: ${orderData.billing_pincode || 'N/A'}
    ` : 'Customer details not available';
    
    // Format order items if available
    let orderItems = 'Order items not available';
    if (orderData && orderData.order_items && orderData.order_items.length > 0) {
      orderItems = orderData.order_items.map(item => 
        `- ${item.name || 'Unknown Product'}: ${item.units || 0} units at ${item.selling_price || 0}`
      ).join('\n');
    }
    
    // Create HTML version of the email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d9534f;">Shiprocket Order Creation Failed</h2>
        <p>${textMessage.replace(/\n/g, '<br>')}</p>
        
        <h3>Customer Details:</h3>
        <pre style="background-color: #f8f9fa; padding: 15px; border-radius: 5px;">${customerDetails}</pre>
        
        <h3>Order Items:</h3>
        <pre style="background-color: #f8f9fa; padding: 15px; border-radius: 5px;">${orderItems}</pre>
        
        <p>This is an automated notification. Please check the order details and assist the customer manually.</p>
      </div>
    `;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: "israelitesshopping171@gmail.com",
      subject: subject,
      text: `${textMessage}\n\nCustomer Details:\n${customerDetails}\n\nOrder Items:\n${orderItems}`,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    console.log("Shiprocket failure notification email sent successfully");
    return true;
  } catch (error) {
    console.error("Error sending Shiprocket failure email:", error);
    return false;
  }
}

// Track Shipment Status
app.get("/shiprocket/track/:shipmentId", async (req, res) => {
  try {
    const token = await getShiprocketToken();
    const { shipmentId } = req.params;
    
    if (!shipmentId) {
      return res.status(400).json({
        success: false,
        message: "Shipment ID is required"
      });
    }
    
    const response = await fetch(`https://apiv2.shiprocket.in/v1/external/courier/track/shipment/${shipmentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    
    res.status(200).json({
      success: true,
      tracking: data
    });
  } catch (error) {
    console.error("Error tracking shipment:", error);
    res.status(500).json({
      success: false,
      message: "Error tracking shipment",
      error: error.message
    });
  }
});

// YouTube Subscription Verification API
app.post("/verify-youtube-subscription", async (req, res) => {
  const { accessToken, channelId, devMode, verificationCode } = req.body;
  
  // Development mode bypass for testing (only use in development!)
  if (devMode === true && verificationCode === process.env.DEV_VERIFICATION_CODE) {
    return res.status(200).json({
      success: true,
      isSubscribed: true,
      message: "Development mode: Subscription verified! 10% discount applied."
    });
  }
  
  try {
    // Fetch the user's subscription list using the access token
    const response = await fetch(`https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    
    const data = await response.json();
    
    if (data.error) {
      return res.status(400).json({
        success: false,
        message: "Failed to verify subscription",
        error: data.error
      });
    }
    
    // Check if the user is subscribed to the specified channel
    const isSubscribed = data.items && data.items.some(
      item => item.snippet.resourceId.channelId === channelId
    );
    
    res.status(200).json({
      success: true,
      isSubscribed,
      message: isSubscribed 
        ? "Subscription verified! 10% discount applied." 
        : "Not subscribed to the channel."
    });
  } catch (error) {
    console.error("YouTube subscription verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify YouTube subscription",
      error: error.message
    });
  }
});

// Email Sending Route
app.post("/send-email", async (req, res) => {
  const { to, subject, message } = req.body;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text: message,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: "Email sent successfully!" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Email sending failed!", error });
  }
});

// Order Confirmation Email Route
app.post("/send-order-confirmation", async (req, res) => {
  const { customerEmail, orderDetails, customerDetails } = req.body;
  
  // Log the incoming request data
  console.log("Received order confirmation request:", { 
    customerEmail, 
    orderDetails: JSON.stringify(orderDetails),
    customerDetails: JSON.stringify(customerDetails) 
  });
  
  if (!customerEmail) {
    return res.status(400).json({
      success: false,
      message: "Customer email is required"
    });
  }
  
  // Format the email content
  const emailSubject = `Order Confirmation #${orderDetails.orderNumber}`;
  
  // Check if orderDetails.products is an array for multiple products
  const hasMultipleProducts = Array.isArray(orderDetails.products) && orderDetails.products.length > 0;
  
  // Generate product table content
  let productsContent = '';
  
  if (hasMultipleProducts) {
    // Create a table for multiple products
    productsContent = `Products:
  +${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+
  | Product Name                            | Quantity | Price        |
  +${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+
  `;

    // Add each product as a row in the table
    orderDetails.products.forEach(product => {
      const name = (product.name || '').padEnd(40).substring(0, 40);
      const quantity = (product.quantity?.toString() || '').padEnd(10).substring(0, 10);
      const price = ((orderDetails.currency || '₹') + ' ' + (product.price || '')).padEnd(15).substring(0, 15);
      
      productsContent += `| ${name} | ${quantity} | ${price} |
  `;
    });
    
    productsContent += `+${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+`;
  } else {
    // Single product format
    productsContent = `Product: ${orderDetails.productName || 'N/A'}
  Quantity: ${orderDetails.quantity || '1'}`;
  }
  
  // Add HTML version of the email
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Order Confirmation</h2>
      <p>Dear ${customerDetails.firstName} ${customerDetails.lastName},</p>
      
      <p>Thank you for your order! We're pleased to confirm that your order has been successfully placed.</p>
      
      <h3>Order Details:</h3>
      <p><strong>Order Number:</strong> ${orderDetails.orderNumber}</p>
      
      ${hasMultipleProducts ? 
        `<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr style="background-color: #f2f2f2;">
            <th style="text-align: left; padding: 8px; border: 1px solid #ddd;">Product Name</th>
            <th style="text-align: center; padding: 8px; border: 1px solid #ddd;">Quantity</th>
            <th style="text-align: right; padding: 8px; border: 1px solid #ddd;">Price</th>
          </tr>
          ${orderDetails.products.map(product => 
            `<tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${product.name || ''}</td>
              <td style="text-align: center; padding: 8px; border: 1px solid #ddd;">${product.quantity || ''}</td>
              <td style="text-align: right; padding: 8px; border: 1px solid #ddd;">${orderDetails.currency || '₹'} ${product.price || ''}</td>
            </tr>`
          ).join('')}
        </table>` 
        : 
        `<p><strong>Product:</strong> ${orderDetails.productName || 'N/A'}<br>
        <strong>Quantity:</strong> ${orderDetails.quantity || '1'}</p>`
      }
      
      <p><strong>Total Amount:</strong> ${orderDetails.currency || '₹'} ${orderDetails.totalAmount}<br>
      <strong>Payment Method:</strong> ${orderDetails.paymentMethod}<br>
      <strong>Payment ID:</strong> ${orderDetails.paymentId || 'N/A'}</p>
      
      <h3>Customer Details:</h3>
      <p>
        <strong>Name:</strong> ${customerDetails.firstName} ${customerDetails.lastName}<br>
        <strong>Email:</strong> ${customerEmail}<br>
        <strong>Phone:</strong> ${customerDetails.phone || 'Not provided'}
      </p>
      
      <h3>Shipping Address:</h3>
      <p>
        ${customerDetails.address || ''}<br>
        ${customerDetails.apartment ? customerDetails.apartment + '<br>' : ''}
        ${customerDetails.city || ''}${customerDetails.city && customerDetails.state ? ', ' : ''}${customerDetails.state || ''}${(customerDetails.city || customerDetails.state) && customerDetails.zip ? ' - ' : ''}${customerDetails.zip || ''}<br>
        ${customerDetails.country || ''}
      </p>
      
      <p>We will process your order shortly. You will receive another email once your order ships.</p>
      
      <p>If you have any questions, please contact our customer service.</p>
      
      <p>Thank you for shopping with us!</p>
      <p>Best regards,<br></p>
    </div>
  `;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: customerEmail,
    cc: process.env.EMAIL_USER, // CC to admin email
    subject: emailSubject,
    html: htmlContent // Add HTML version for better formatting
  };

  try {
    console.log("Attempting to send email to:", customerEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    res.status(200).json({ success: true, message: "Confirmation email sent successfully!" });
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    res.status(500).json({ success: false, message: "Failed to send confirmation email", error: error.message });
  }
  });

// Abandoned Order Follow-up Email Route

app.post("/send-abandoned-order-email", async (req, res) => {
  const { customerEmail, orderDetails, customerDetails } = req.body;
  
  console.log("Received abandoned order follow-up request:", { 
    customerEmail, 
    orderDetails: JSON.stringify(orderDetails),
    customerDetails: JSON.stringify(customerDetails) 
  });
  
  if (!customerEmail) {
    return res.status(400).json({
      success: false,
      message: "Customer email is required"
    });
  }
  
  // Format the email content
  const emailSubject = `We noticed you didn't complete your order #${orderDetails.orderNumber}`;
  
  // Check if orderDetails.products is an array for multiple products
  const hasMultipleProducts = Array.isArray(orderDetails.products) && orderDetails.products.length > 0;
  
  // Generate product table content
  let productsContent = '';
  
  if (hasMultipleProducts) {
    // Create a table for multiple products
    productsContent = `Products:
  +${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+
  | Product Name                            | Quantity | Price        |
  +${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+
  `;

    // Add each product as a row in the table
    orderDetails.products.forEach(product => {
      const name = (product.name || '').padEnd(40).substring(0, 40);
      const quantity = (product.quantity?.toString() || '').padEnd(10).substring(0, 10);
      const price = ((orderDetails.currency || '₹') + ' ' + (product.price || '')).padEnd(15).substring(0, 15);
      
      productsContent += `| ${name} | ${quantity} | ${price} |
  `;
    });
    
    productsContent += `+${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+`;
  } else {
    // Single product format
    productsContent = `Product: ${orderDetails.productName || 'N/A'}
  Quantity: ${orderDetails.quantity || '1'}`;
  }
  
  // Enhanced email template with better formatting for customer details
  const emailContent = `
    Dear ${customerDetails.firstName} ${customerDetails.lastName},
    
    We noticed that you recently started an order on our website but didn't complete the checkout process.
    
    Customer Details:
    - Name: ${customerDetails.firstName} ${customerDetails.lastName}
    - Email: ${customerDetails.email}
    - Phone: ${customerDetails.phone || 'Not provided'}
    
    Address Information:
    ${customerDetails.address || 'Address not provided'}
    ${customerDetails.apartment ? customerDetails.apartment + '\n' : ''}
    ${customerDetails.city || ''}${customerDetails.city && customerDetails.state ? ', ' : ''}${customerDetails.state || ''}${(customerDetails.city || customerDetails.state) && customerDetails.zip ? ' - ' : ''}${customerDetails.zip || ''}
    ${customerDetails.country || ''}
    
    Order Details:
    - Order ID: ${orderDetails.orderNumber}
    ${productsContent}
    - Total Amount: ${orderDetails.currency || '₹'} ${orderDetails.totalAmount}
    
    We'd love to know if you experienced any issues during checkout or if you have any questions about our product.
    You can simply reply to this email, and we'll be happy to assist you.
    
    If you'd like to complete your purchase, you can return to our website and try again.
    
    Thank you for considering our products!
    Best regards,
    
  `;
  
  // Add HTML version of the email
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Your Shopping Cart is Waiting</h2>
      <p>Dear ${customerDetails.firstName} ${customerDetails.lastName},</p>
      
      <p>We noticed that you recently started an order on our website but didn't complete the checkout process.</p>
      
      <h3>Order Details:</h3>
      <p><strong>Order Number:</strong> ${orderDetails.orderNumber}</p>
      
      ${hasMultipleProducts ? 
        `<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr style="background-color: #f2f2f2;">
            <th style="text-align: left; padding: 8px; border: 1px solid #ddd;">Product Name</th>
            <th style="text-align: center; padding: 8px; border: 1px solid #ddd;">Quantity</th>
            <th style="text-align: right; padding: 8px; border: 1px solid #ddd;">Price</th>
          </tr>
          ${orderDetails.products.map(product => 
            `<tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${product.name || ''}</td>
              <td style="text-align: center; padding: 8px; border: 1px solid #ddd;">${product.quantity || ''}</td>
              <td style="text-align: right; padding: 8px; border: 1px solid #ddd;">${orderDetails.currency || '₹'} ${product.price || ''}</td>
            </tr>`
          ).join('')}
        </table>` 
        : 
        `<p><strong>Product:</strong> ${orderDetails.productName || 'N/A'}<br>
        <strong>Quantity:</strong> ${orderDetails.quantity || '1'}</p>`
      }
      
      <p><strong>Total Amount:</strong> ${orderDetails.currency || '₹'} ${orderDetails.totalAmount}</p>
      
      <h3>Customer Details:</h3>
      <p>
        <strong>Name:</strong> ${customerDetails.firstName} ${customerDetails.lastName}<br>
        <strong>Email:</strong> ${customerDetails.email}<br>
        <strong>Phone:</strong> ${customerDetails.phone || 'Not provided'}
      </p>
      
      <h3>Shipping Address:</h3>
      <p>
        ${customerDetails.address || ''}<br>
        ${customerDetails.apartment ? customerDetails.apartment + '<br>' : ''}
        ${customerDetails.city || ''}${customerDetails.city && customerDetails.state ? ', ' : ''}${customerDetails.state || ''}${(customerDetails.city || customerDetails.state) && customerDetails.zip ? ' - ' : ''}${customerDetails.zip || ''}<br>
        ${customerDetails.country || ''}
      </p>
      
      <p>We'd love to know if you experienced any issues during checkout or if you have any questions about our product.</p>
      <p>You can simply reply to this email, and we'll be happy to assist you.</p>
      
      <p>If you'd like to complete your purchase, you can return to our website and try again.</p>
      
      <p>Thank you for considering our products!</p>
      
      <p>Best regards,<br></p>
    </div>
  `;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: customerEmail,
    cc: process.env.EMAIL_USER, // CC to admin email
    subject: emailSubject,
    html: htmlContent // Add HTML version for better formatting
  };

  try {
    console.log("Attempting to send abandoned order follow-up email to:", customerEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log("Abandoned order follow-up email sent successfully:", info.messageId);
    res.status(200).json({ success: true, message: "Abandoned order follow-up email sent successfully!" });
  } catch (error) {
    console.error("Error sending abandoned order follow-up email:", error);
    res.status(500).json({ success: false, message: "Failed to send abandoned order follow-up email", error: error.message });
  }
});

// Create Razorpay Order
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency, receipt, notes } = req.body;
    
    const options = {
      amount: amount * 100, // Convert to paise (Razorpay requires amount in smallest currency unit)
      currency: currency || "INR",
      receipt: receipt || `receipt_${Date.now()}`,
      notes: notes || {},
    };
    
    const order = await razorpay.orders.create(options);
    
    res.status(200).json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID, // Send key_id to frontend for initialization
    });
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
});

// Verify Razorpay Payment
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // Verify signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest("hex");
      
    const isAuthentic = expectedSignature === razorpay_signature;
    
    if (isAuthentic) {
      // Payment verification successful
      res.status(200).json({ 
        success: true,
        message: "Payment verification successful",
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      });
    } else {
      // Payment verification failed
      res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }
  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during verification",
      error: error.message,
    });
  }
});



// Order Confirmation Email Route
app.post("/agent_to_customer", async (req, res) => {
  const { customerEmail, orderDetails, customerDetails, productName } = req.body;
  
  // Log the incoming request data
  console.log("Received order confirmation request:", { 
    customerEmail, 
    orderDetails: JSON.stringify(orderDetails),
    customerDetails: JSON.stringify(customerDetails),
    productName
  });
  
  if (!customerEmail) {
    return res.status(400).json({
      success: false,
      message: "Customer email is required"
    });
  }
  
  // Format the email content
  const emailSubject = `Order Confirmation #${orderDetails.orderNumber}`;
  
  // Check if orderDetails.products is an array for multiple products
  const hasMultipleProducts = Array.isArray(orderDetails.products) && orderDetails.products.length > 0;
  
  // Generate product table content
  let productsContent = '';
  
  if (hasMultipleProducts) {
    // Create a table for multiple products
    productsContent = `Products:
    +${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+
    | Product Name                            | Quantity | Price        |
    +${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+`;

    // Add each product as a row in the table
    orderDetails.products.forEach(product => {
      const name = (product.name || '').padEnd(40).substring(0, 40);
      const quantity = (product.quantity?.toString() || '').padEnd(10).substring(0, 10);
      const price = ((orderDetails.currency || '₹') + ' ' + (product.price || '')).padEnd(15).substring(0, 15);
      
      productsContent += `| ${name} | ${quantity} | ${price} |`;
    });
    
    productsContent += `+${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+`;
  } else {
    // Single product format
    productsContent = `Product: ${orderDetails.productName || 'N/A'}
    Quantity: ${orderDetails.quantity || '1'}`;
  }
  
  // Add HTML version of the email
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8f9fa;">
            <tr>
                <td align="center" style="padding: 20px 0;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
                        
                        <!-- Header with Brand -->
                        <tr>
                            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
                                <div style="background-color: white; width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                                    <img src="https://cdn-icons-png.flaticon.com/512/2331/2331970.png" alt="Order Confirmed" style="width: 50px; height: 50px;">
                                </div>
                                <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">Order Confirmed!</h1>
                                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Thank you for your purchase</p>
                            </td>
                        </tr>
                        
                        <!-- Main Content -->
                        <tr>
                            <td style="padding: 40px 30px;">
                                
                                <!-- Greeting -->
                                <div style="margin-bottom: 30px;">
                                    <h2 style="color: #2c3e50; margin: 0 0 15px; font-size: 24px; font-weight: 600;">Hello ${customerDetails.firstName}! 👋</h2>
                                    <p style="color: #5a6c7d; line-height: 1.6; margin: 0; font-size: 16px;">
                                        We're excited to confirm that your order has been successfully placed and is being processed. Here are the details:
                                    </p>
                                </div>
                                
                                <!-- Order Summary Card -->
                                <div style="background: linear-gradient(145deg, #f8f9ff 0%, #e8f2ff 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; border: 1px solid #e3f2fd;">
                                    <div style="display: flex; align-items: center; margin-bottom: 20px;">
                                        <img src="https://cdn-icons-png.flaticon.com/512/3081/3081559.png" alt="Order" style="width: 24px; height: 24px; margin-right: 10px;">
                                        <h3 style="color: #2c3e50; margin: 0; font-size: 20px; font-weight: 600;">Order Summary</h3>
                                    </div>
                                    
                                    <table style="width: 100%; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Order Number:</td>
                                            <td style="padding: 8px 0; color: #2c3e50; font-weight: 700; text-align: right;">#${orderDetails.orderNumber}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Total Amount:</td>
                                            <td style="padding: 8px 0; color: #27ae60; font-weight: 700; text-align: right; font-size: 18px;">${orderDetails.currency || '₹'} ${orderDetails.totalAmount}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Advance Paid:</td>
                                            <td style="padding: 8px 0; color: #e67e22; font-weight: 700; text-align: right;">${orderDetails.currency || '₹'} ${orderDetails.Advance_Amount}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Payment Method:</td>
                                            <td style="padding: 8px 0; color: #2c3e50; font-weight: 600; text-align: right;">${orderDetails.paymentMethod}</td>
                                        </tr>
                                    </table>
                                </div>
                                
                                <!-- Products Section -->
                                <div style="margin-bottom: 30px;">
                                    <div style="display: flex; align-items: center; margin-bottom: 20px;">
                                        <img src="https://cdn-icons-png.flaticon.com/512/3514/3514491.png" alt="Products" style="width: 24px; height: 24px; margin-right: 10px;">
                                        <h3 style="color: #2c3e50; margin: 0; font-size: 20px; font-weight: 600;">Products Ordered</h3>
                                    </div>
                                    
                                    ${hasMultipleProducts ? 
                                        `<div style="border: 1px solid #e3f2fd; border-radius: 8px; overflow: hidden;">
                                            <table style="width: 100%; border-collapse: collapse;">
                                                <thead>
                                                    <tr style="background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);">
                                                        <th style="text-align: left; padding: 15px; color: white; font-weight: 600;">Product</th>
                                                        <th style="text-align: center; padding: 15px; color: white; font-weight: 600;">Qty</th>
                                                        <th style="text-align: right; padding: 15px; color: white; font-weight: 600;">Price</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${orderDetails.products.map((product, index) => 
                                                        `<tr style="background-color: ${index % 2 === 0 ? '#f8f9ff' : '#ffffff'};">
                                                            <td style="padding: 15px; color: #2c3e50; font-weight: 500; border-bottom: 1px solid #e9ecef;">${product.name || 'N/A'}</td>
                                                            <td style="text-align: center; padding: 15px; color: #5a6c7d; font-weight: 600; border-bottom: 1px solid #e9ecef;">${product.quantity || '1'}</td>
                                                            <td style="text-align: right; padding: 15px; color: #27ae60; font-weight: 700; border-bottom: 1px solid #e9ecef;">${orderDetails.currency || '₹'} ${product.price || '0'}</td>
                                                        </tr>`
                                                    ).join('')}
                                                </tbody>
                                            </table>
                                        </div>` 
                                        : 
                                        `<div style="background-color: #f8f9ff; border: 1px solid #e3f2fd; border-radius: 8px; padding: 20px;">
                                            <div style="display: flex; align-items: center; justify-content: between;">
                                                <div>
                                                    <h4 style="color: #2c3e50; margin: 0 0 5px; font-size: 18px; font-weight: 600;">${orderDetails.productName || productName || 'N/A'}</h4>
                                                    <p style="color: #5a6c7d; margin: 0; font-size: 14px;">Quantity: ${orderDetails.quantity || '1'}</p>
                                                </div>
                                                <div style="text-align: right;">
                                                    <p style="color: #27ae60; margin: 0; font-size: 18px; font-weight: 700;">${orderDetails.currency || '₹'} ${orderDetails.totalAmount}</p>
                                                </div>
                                            </div>
                                        </div>`
                                    }
                                </div>
                                
                                <!-- Customer & Shipping Info -->
                                <div style="display: flex; gap: 20px; margin-bottom: 30px;">
                                    <!-- Customer Details -->
                                    <div style="flex: 1; background-color: #f8f9ff; border: 1px solid #e3f2fd; border-radius: 8px; padding: 20px;">
                                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                            <img src="https://cdn-icons-png.flaticon.com/512/3135/3135715.png" alt="Customer" style="width: 20px; height: 20px; margin-right: 8px;">
                                            <h4 style="color: #2c3e50; margin: 0; font-size: 16px; font-weight: 600;">Customer Details</h4>
                                        </div>
                                        <p style="color: #2c3e50; margin: 0 0 8px; font-weight: 600;">${customerDetails.firstName} ${customerDetails.lastName}</p>
                                        <p style="color: #5a6c7d; margin: 0 0 5px; font-size: 14px;">${customerEmail}</p>
                                        <p style="color: #5a6c7d; margin: 0; font-size: 14px;">${customerDetails.phone || 'Phone not provided'}</p>
                                    </div>
                                    
                                    <!-- Shipping Address -->
                                    <div style="flex: 1; background-color: #f8f9ff; border: 1px solid #e3f2fd; border-radius: 8px; padding: 20px;">
                                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                            <img src="https://cdn-icons-png.flaticon.com/512/854/854929.png" alt="Shipping" style="width: 20px; height: 20px; margin-right: 8px;">
                                            <h4 style="color: #2c3e50; margin: 0; font-size: 16px; font-weight: 600;">Shipping Address</h4>
                                        </div>
                                        <div style="color: #5a6c7d; font-size: 14px; line-height: 1.5;">
                                            ${customerDetails.address || ''}<br>
                                            ${customerDetails.apartment ? customerDetails.apartment + '<br>' : ''}
                                            ${customerDetails.city || ''}${customerDetails.city && customerDetails.state ? ', ' : ''}${customerDetails.state || ''}${(customerDetails.city || customerDetails.state) && customerDetails.zip ? ' - ' : ''}${customerDetails.zip || ''}<br>
                                            ${customerDetails.country || ''}
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Status Timeline -->
                                <div style="background: linear-gradient(145deg, #e8f5e8 0%, #f0f8f0 100%); border: 1px solid #c8e6c9; border-radius: 12px; padding: 25px; margin-bottom: 30px;">
                                    <div style="display: flex; align-items: center; margin-bottom: 20px;">
                                        <img src="https://cdn-icons-png.flaticon.com/512/2143/2143150.png" alt="Timeline" style="width: 24px; height: 24px; margin-right: 10px;">
                                        <h3 style="color: #2c3e50; margin: 0; font-size: 20px; font-weight: 600;">What's Next?</h3>
                                    </div>
                                    
                                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                        <div style="width: 12px; height: 12px; background-color: #27ae60; border-radius: 50%; margin-right: 15px;"></div>
                                        <div>
                                            <p style="color: #27ae60; margin: 0; font-weight: 600; font-size: 14px;">✓ Order Confirmed</p>
                                            <p style="color: #5a6c7d; margin: 0; font-size: 12px;">We've received your order and payment</p>
                                        </div>
                                    </div>
                                    
                                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                        <div style="width: 12px; height: 12px; background-color: #f39c12; border-radius: 50%; margin-right: 15px;"></div>
                                        <div>
                                            <p style="color: #f39c12; margin: 0; font-weight: 600; font-size: 14px;">⏳ Processing</p>
                                            <p style="color: #5a6c7d; margin: 0; font-size: 12px;">We're preparing your order for shipment</p>
                                        </div>
                                    </div>
                                    
                                    <div style="display: flex; align-items: center;">
                                        <div style="width: 12px; height: 12px; background-color: #bdc3c7; border-radius: 50%; margin-right: 15px;"></div>
                                        <div>
                                            <p style="color: #5a6c7d; margin: 0; font-weight: 600; font-size: 14px;">📦 Shipping</p>
                                            <p style="color: #5a6c7d; margin: 0; font-size: 12px;">You'll receive tracking details once shipped</p>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Call to Action -->
                                <div style="text-align: center; margin-bottom: 30px;">
                                    <p style="color: #5a6c7d; margin: 0 0 20px; font-size: 16px;">Need help with your order?</p>
                                    <a href="mailto:israelitesshopping171@gmail.com" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 12px 30px; border-radius: 25px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">Contact Support</a>
                                </div>
                                
                            </td>
                        </tr>
                        
                        <!-- Footer -->
                        <tr>
                            <td style="background-color: #2c3e50; padding: 30px; text-align: center;">
                                <div style="margin-bottom: 20px;">
                                    <img src="https://cdn-icons-png.flaticon.com/512/3176/3176363.png" alt="Store Logo" style="width: 60px; height: 60px; opacity: 0.8;">
                                </div>
                                <p style="color: white; margin: 0 0 10px; font-size: 18px; font-weight: 600;">Thank you for choosing us!</p>
                                <p style="color: rgba(255,255,255,0.8); margin: 0 0 20px; font-size: 14px;">We appreciate your business and look forward to serving you again.</p>
                                
                                <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 12px;">
                                    © 2025 ${orderDetails.productName || productName || 'N/A'}. All rights reserved.<br>
                                    This email was sent to ${customerEmail}
                                </p>
                            </td>
                        </tr>
                        
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: customerEmail,
    cc: process.env.EMAIL_USER, // CC to admin email
    subject: emailSubject,
    html: htmlContent // Add HTML version for better formatting
  };

    try {
      console.log("Attempting to send email to:", customerEmail);
      const info = await transporter.sendMail(mailOptions);
      console.log("Email sent successfully:", info.messageId);
      res.status(200).json({ success: true, message: "Confirmation email sent successfully!" });
    } catch (error) {
      console.error("Error sending confirmation email:", error);
      res.status(500).json({ success: false, message: "Failed to send confirmation email", error: error.message });
    }
  });

// Advance Payment Order Confirmation Email Route
app.post("/send-advance-payment-confirmation", async (req, res) => {
  const { customerEmail, orderDetails, customerDetails, productName } = req.body;
  
  // Log the incoming request data
  console.log("Received advance payment confirmation request:", { 
    customerEmail, 
    orderDetails: JSON.stringify(orderDetails),
    customerDetails: JSON.stringify(customerDetails),
    productName
  });
  
  if (!customerEmail) {
    return res.status(400).json({
      success: false,
      message: "Customer email is required"
    });
  }
  
  // Format the email content
  const emailSubject = `Advance Payment Confirmed - Order #${orderDetails.orderNumber}`;
  
  // Check if orderDetails.products is an array for multiple products
  const hasMultipleProducts = Array.isArray(orderDetails.products) && orderDetails.products.length > 0;
  
  // Generate product table content
  let productsContent = '';
  
  if (hasMultipleProducts) {
    // Create a table for multiple products
    productsContent = `Products:
    +${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+
    | Product Name                            | Quantity | Price        |
    +${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+`;

    // Add each product as a row in the table
    orderDetails.products.forEach(product => {
      const name = (product.name || '').padEnd(40).substring(0, 40);
      const quantity = (product.quantity?.toString() || '').padEnd(10).substring(0, 10);
      const price = ((orderDetails.currency || '₹') + ' ' + (product.price || '')).padEnd(15).substring(0, 15);
      
      productsContent += `| ${name} | ${quantity} | ${price} |`;
    });
    
    productsContent += `+${'-'.repeat(40)}+${'-'.repeat(10)}+${'-'.repeat(15)}+`;
  } else {
    // Single product format
    productsContent = `Product: ${orderDetails.productName || 'N/A'}
    Quantity: ${orderDetails.quantity || '1'}`;
  }
  
  // Add HTML version of the email with advance payment focus
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Advance Payment Confirmed</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8f9fa;">
            <tr>
                <td align="center" style="padding: 20px 0;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
                        
                        <!-- Header with Advance Payment Focus -->
                        <tr>
                            <td style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); padding: 40px 30px; text-align: center;">
                                <div style="background-color: white; width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                                    <img src="https://cdn-icons-png.flaticon.com/512/3135/3135706.png" alt="Advance Payment" style="width: 50px; height: 50px;">
                                </div>
                                <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">Advance Payment Received!</h1>
                                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Your order is confirmed with partial payment</p>
                            </td>
                        </tr>
                        
                        <!-- Main Content -->
                        <tr>
                            <td style="padding: 40px 30px;">
                                
                                <!-- Greeting -->
                                <div style="margin-bottom: 30px;">
                                    <h2 style="color: #2c3e50; margin: 0 0 15px; font-size: 24px; font-weight: 600;">Hello ${customerDetails.firstName}! 👋</h2>
                                    <p style="color: #5a6c7d; line-height: 1.6; margin: 0; font-size: 16px;">
                                        Great news! We've successfully received your advance payment and your order is now confirmed. Here are the complete details:
                                    </p>
                                </div>
                                
                                <!-- Payment Status Card -->
                                <div style="background: linear-gradient(145deg, #fff3e0 0%, #ffe0b2 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; border: 2px solid #ff9800;">
                                    <div style="display: flex; align-items: center; margin-bottom: 20px;">
                                        <img src="https://cdn-icons-png.flaticon.com/512/3135/3135706.png" alt="Payment" style="width: 24px; height: 24px; margin-right: 10px;">
                                        <h3 style="color: #e65100; margin: 0; font-size: 20px; font-weight: 600;">💰 Payment Summary</h3>
                                    </div>
                                    
                                    <table style="width: 100%; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Order Total:</td>
                                            <td style="padding: 8px 0; color: #2c3e50; font-weight: 700, text-align: right; font-size: 18px;">${orderDetails.currency || '₹'} ${orderDetails.totalAmount}</td>
                                        </tr>
                                        <tr style="background-color: rgba(76, 175, 80, 0.1);">
                                            <td style="padding: 12px 8px; color: #2e7d32; font-weight: 600; border-radius: 8px;">✅ Advance Paid:</td>
                                            <td style="padding: 12px 8px; color: #2e7d32; font-weight: 800; text-align: right; font-size: 20px; border-radius: 8px;">${orderDetails.currency || '₹'} ${orderDetails.advanceAmount || orderDetails.paidAmount}</td>
                                        </tr>
                                        <tr style="background-color: rgba(255, 152, 0, 0.1);">
                                            <td style="padding: 12px 8px; color: #f57c00; font-weight: 600; border-radius: 8px;">⏳ Balance Due on Delivery:</td>
                                            <td style="padding: 12px 8px; color: #f57c00; font-weight: 800; text-align: right; font-size: 20px; border-radius: 8px;">${orderDetails.currency || '₹'} ${orderDetails.balanceAmount || (orderDetails.totalAmount - (orderDetails.advanceAmount || orderDetails.paidAmount))}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Payment Method:</td>
                                            <td style="padding: 8px 0; color: #2c3e50; font-weight: 600; text-align: right;">${orderDetails.paymentMethod} (Advance)</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Payment ID:</td>
                                            <td style="padding: 8px 0; color: #2c3e50; font-weight: 600; text-align: right; font-size: 12px;">${orderDetails.paymentId || 'N/A'}</td>
                                        </tr>
                                    </table>
                                </div>
                                
                                <!-- Order Summary Card -->
                                <div style="background: linear-gradient(145deg, #f8f9ff 0%, #e8f2ff 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; border: 1px solid #e3f2fd;">
                                    <div style="display: flex; align-items: center; margin-bottom: 20px;">
                                        <img src="https://cdn-icons-png.flaticon.com/512/3081/3081559.png" alt="Order" style="width: 24px; height: 24px; margin-right: 10px;">
                                        <h3 style="color: #2c3e50; margin: 0; font-size: 20px; font-weight: 600;">📦 Order Details</h3>
                                    </div>
                                    
                                    <table style="width: 100%; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Order Number:</td>
                                            <td style="padding: 8px 0; color: #2c3e50; font-weight: 700; text-align: right;">#${orderDetails.orderNumber}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Product:</td>
                                            <td style="padding: 8px 0; color: #2c3e50; font-weight: 600; text-align: right;">${orderDetails.productName || productName || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Quantity:</td>
                                            <td style="padding: 8px 0; color: #2c3e50; font-weight: 600; text-align: right;">${orderDetails.quantity || '1'}</td>
                                        </tr>
                                    </table>
                                </div>
                                
                                <!-- Important Notice for COD Balance -->
                                <div style="background: linear-gradient(145deg, #fff8e1 0%, #ffecb3 100%); border: 2px solid #ffc107; border-radius: 12px; padding: 25px; margin-bottom: 30px;">
                                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                        <img src="https://cdn-icons-png.flaticon.com/512/1828/1828843.png" alt="Important" style="width: 24px; height: 24px; margin-right: 10px;">
                                        <h3 style="color: #f57c00; margin: 0; font-size: 18px; font-weight: 600;">🚨 Important: Balance Payment on Delivery</h3>
                                    </div>
                                    <div style="color: #ef6c00; font-size: 16px; line-height: 1.6;">
                                        <p style="margin: 0 0 10px;"><strong>Please keep ready:</strong> ${orderDetails.currency || '₹'} ${orderDetails.balanceAmount || (orderDetails.totalAmount - (orderDetails.advanceAmount || orderDetails.paidAmount))} for cash payment when your order arrives.</p>
                                        <p style="margin: 0; font-size: 14px; color: #8d4e00;">Our delivery partner will collect the remaining balance amount in cash upon delivery. Please ensure you have the exact amount ready.</p>
                                    </div>
                                </div>
                                
                                <!-- Customer & Shipping Info -->
                                <div style="display: flex; gap: 20px; margin-bottom: 30px;">
                                    <!-- Customer Details -->
                                    <div style="flex: 1; background-color: #f8f9ff; border: 1px solid #e3f2fd; border-radius: 8px; padding: 20px;">
                                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                            <img src="https://cdn-icons-png.flaticon.com/512/3135/3135715.png" alt="Customer" style="width: 20px; height: 20px; margin-right: 8px;">
                                            <h4 style="color: #2c3e50; margin: 0; font-size: 16px; font-weight: 600;">Customer Details</h4>
                                        </div>
                                        <p style="color: #2c3e50; margin: 0 0 8px; font-weight: 600;">${customerDetails.firstName} ${customerDetails.lastName}</p>
                                        <p style="color: #5a6c7d; margin: 0 0 5px; font-size: 14px;">${customerEmail}</p>
                                        <p style="color: #5a6c7d; margin: 0; font-size: 14px;">${customerDetails.phone || 'Phone not provided'}</p>
                                    </div>
                                    
                                    <!-- Shipping Address -->
                                    <div style="flex: 1; background-color: #f8f9ff; border: 1px solid #e3f2fd; border-radius: 8px; padding: 20px;">
                                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                            <img src="https://cdn-icons-png.flaticon.com/512/854/854929.png" alt="Shipping" style="width: 20px; height: 20px; margin-right: 8px;">
                                            <h4 style="color: #2c3e50; margin: 0; font-size: 16px; font-weight: 600;">Delivery Address</h4>
                                        </div>
                                        <div style="color: #5a6c7d; font-size: 14px; line-height: 1.5;">
                                            ${customerDetails.address || ''}<br>
                                            ${customerDetails.apartment ? customerDetails.apartment + '<br>' : ''}
                                            ${customerDetails.city || ''}${customerDetails.city && customerDetails.state ? ', ' : ''}${customerDetails.state || ''}${(customerDetails.city || customerDetails.state) && customerDetails.zip ? ' - ' : ''}${customerDetails.zip || ''}<br>
                                            ${customerDetails.country || ''}
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Status Timeline for Advance Payment -->
                                <div style="background: linear-gradient(145deg, #e8f5e8 0%, #f0f8f0 100%); border: 1px solid #c8e6c9; border-radius: 12px; padding: 25px; margin-bottom: 30px;">
                                    <div style="display: flex; align-items: center; margin-bottom: 20px;">
                                        <img src="https://cdn-icons-png.flaticon.com/512/2143/2143150.png" alt="Timeline" style="width: 24px; height: 24px; margin-right: 10px;">
                                        <h3 style="color: #2c3e50; margin: 0; font-size: 20px; font-weight: 600;">📋 Order Progress</h3>
                                    </div>
                                    
                                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                        <div style="width: 12px; height: 12px; background-color: #27ae60; border-radius: 50%; margin-right: 15px;"></div>
                                        <div>
                                            <p style="color: #27ae60; margin: 0; font-weight: 600; font-size: 14px;">✓ Advance Payment Received</p>
                                            <p style="color: #5a6c7d; margin: 0; font-size: 12px;">${orderDetails.currency || '₹'} ${orderDetails.advanceAmount || orderDetails.paidAmount} paid successfully</p>
                                        </div>
                                    </div>
                                    
                                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                        <div style="width: 12px; height: 12px; background-color: #f39c12; border-radius: 50%; margin-right: 15px;"></div>
                                        <div>
                                            <p style="color: #f39c12; margin: 0; font-weight: 600; font-size: 14px;">⏳ Processing Your Order</p>
                                            <p style="color: #5a6c7d; margin: 0; font-size: 12px;">We're preparing your order for shipment</p>
                                        </div>
                                    </div>
                                    
                                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                                        <div style="width: 12px; height: 12px; background-color: #bdc3c7; border-radius: 50%; margin-right: 15px;"></div>
                                        <div>
                                            <p style="color: #5a6c7d; margin: 0; font-weight: 600; font-size: 14px;">📦 Out for Delivery</p>
                                            <p style="color: #5a6c7d; margin: 0; font-size: 12px;">You'll receive tracking details once shipped</p>
                                        </div>
                                    </div>
                                    
                                    <div style="display: flex; align-items: center;">
                                        <div style="width: 12px; height: 12px; background-color: #bdc3c7; border-radius: 50%; margin-right: 15px;"></div>
                                        <div>
                                            <p style="color: #5a6c7d; margin: 0; font-weight: 600; font-size: 14px;">💰 Balance Payment & Delivery</p>
                                            <p style="color: #5a6c7d; margin: 0; font-size: 12px;">Pay ${orderDetails.currency || '₹'} ${orderDetails.balanceAmount || (orderDetails.totalAmount - (orderDetails.advanceAmount || orderDetails.paidAmount))} in cash upon delivery</p>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Call to Action -->
                                <div style="text-align: center; margin-bottom: 30px;">
                                    <p style="color: #5a6c7d; margin: 0 0 20px; font-size: 16px;">Questions about your advance payment order?</p>
                                    <a href="mailto:israelitesshopping171@gmail.com" style="display: inline-block; background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; text-decoration: none; padding: 12px 30px; border-radius: 25px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(255, 152, 0, 0.4);">Contact Support</a>
                                </div>
                                
                            </td>
                        </tr>
                        
                        <!-- Footer -->
                        <tr>
                            <td style="background-color: #2c3e50; padding: 30px; text-align: center;">
                                <div style="margin-bottom: 20px;">
                                    <img src="https://cdn-icons-png.flaticon.com/512/3176/3176363.png" alt="Store Logo" style="width: 60px; height: 60px; opacity: 0.8;">
                                </div>
                                <p style="color: white; margin: 0 0 10px; font-size: 18px; font-weight: 600;">Thank you for your advance payment!</p>
                                <p style="color: rgba(255,255,255,0.8); margin: 0 0 20px; font-size: 14px;">Your order is confirmed and will be delivered soon. Don't forget the balance payment!</p>
                                
                                <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 12px;">
                                    © 2025 ${orderDetails.productName || productName || 'Our Store'}. All rights reserved.<br>
                                    This email was sent to ${customerEmail}
                                </p>
                            </td>
                        </tr>
                        
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: customerEmail,
    cc: process.env.EMAIL_USER, // CC to admin email
    subject: emailSubject,
    html: htmlContent // Add HTML version for better formatting
  };

  try {
    console.log("Attempting to send advance payment confirmation email to:", customerEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log("Advance payment confirmation email sent successfully:", info.messageId);
    res.status(200).json({ success: true, message: "Advance payment confirmation email sent successfully!" });
  } catch (error) {
    console.error("Error sending advance payment confirmation email:", error);
    res.status(500).json({ success: false, message: "Failed to send advance payment confirmation email", error: error.message });
  }
});

// Server Metrics Route
app.get("/server-metrics", (req, res) => {
  // Get initial CPU measurements
  const startCpuUsage = process.cpuUsage();
  
  // Add a small delay to measure CPU usage over time
  setTimeout(() => {
    // Get CPU usage after delay to calculate difference
    const endCpuUsage = process.cpuUsage(startCpuUsage);
    
    // Get memory usage
    const memoryUsage = process.memoryUsage();
    
    // Format and return the metrics
    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      cpu: {
        user: `${Math.round(endCpuUsage.user / 1000)} microseconds`,
        system: `${Math.round(endCpuUsage.system / 1000)} microseconds`,
      },
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`, // Resident Set Size
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`, // Total heap size
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`, // Used heap size
        external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`, // External memory
        arrayBuffers: `${Math.round((memoryUsage.arrayBuffers || 0) / 1024 / 1024)} MB` // ArrayBuffers memory
      }
    });
  }, 100); // 100ms delay to measure CPU usage
});





// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});