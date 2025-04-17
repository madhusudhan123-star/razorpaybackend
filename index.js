require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const bodyParser = require("body-parser");
const Razorpay = require("razorpay"); // Add Razorpay SDK
const crypto = require("crypto"); // For payment verification

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
    'https://beyondslim.in', // Fixed: added missing comma
    'https://glowglaz.com', // Fixed: removed trailing slash
    'https://glowglaz-vert.vercel.app', // Added new origin
    'https://drjoints.in', // Fixed: removed trailing slash
    'https://drjoints.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
  
  // Enhanced email template with more customer details
  const emailContent = `
    Dear ${customerDetails.firstName} ${customerDetails.lastName},
    
    Thank you for your order! We're pleased to confirm that your order has been successfully placed.
    
    Order Details:
    - Order Number: ${orderDetails.orderNumber}
    - Product: ${orderDetails.productName}
    - Quantity: ${orderDetails.quantity}
    - Total Amount: ${orderDetails.currency || '₹'} ${orderDetails.totalAmount}
    - Payment Method: ${orderDetails.paymentMethod}
    - Payment ID: ${orderDetails.paymentId || 'N/A'}
    
    Customer Details:
    - Name: ${customerDetails.firstName} ${customerDetails.lastName}
    - Email: ${customerEmail}
    - Phone: ${customerDetails.phone || 'Not provided'}
    
    Shipping Address:
    ${customerDetails.address || ''}
    ${customerDetails.apartment ? customerDetails.apartment + '\n' : ''}
    ${customerDetails.city || ''}${customerDetails.city && customerDetails.state ? ', ' : ''}${customerDetails.state || ''}${(customerDetails.city || customerDetails.state) && customerDetails.zip ? ' - ' : ''}${customerDetails.zip || ''}
    ${customerDetails.country || ''}
    
    We will process your order shortly. You will receive another email once your order ships.
    
    If you have any questions, please contact our customer service.
    
    Thank you for shopping with us!
    
    Best regards,
    PSORIGO Team
  `;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: customerEmail,
    cc: process.env.EMAIL_USER, // CC to admin email
    subject: emailSubject,
    text: emailContent,
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
    - Product: ${orderDetails.productName}
    - Quantity: ${orderDetails.quantity}
    - Total Amount: ${orderDetails.currency || '₹'} ${orderDetails.totalAmount}
    
    We'd love to know if you experienced any issues during checkout or if you have any questions about our product.
    You can simply reply to this email, and we'll be happy to assist you.
    
    If you'd like to complete your purchase, you can return to our website and try again.
    
    Thank you for considering our products!
    
    Best regards,
    PSORIGO Team
  `;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: customerEmail,
    cc: process.env.EMAIL_USER, // CC to admin email
    subject: emailSubject,
    text: emailContent,
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
