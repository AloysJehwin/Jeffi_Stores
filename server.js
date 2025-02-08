const express = require('express');
const mysql = require('mysql2');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');
const path = require('path');
const bodyParser = require('body-parser');

dotenv.config();


// Initialize Express app
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Setup AWS S3 v3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Setup MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.log('Error connecting to the database: ', err);
    return;
  }
  console.log('Connected to MySQL database!');
});

// Multer storage setup
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Redirect to index page
// Redirect to login page directly
app.get('/', (req, res) => {
  res.redirect('/login');
});


// Render login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Handle login request
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Query the database for the admin user
  const query = 'SELECT * FROM admin WHERE username = ? AND password = ?';
  db.query(query, [username, password], (err, result) => {
    if (err) {
      console.log('Error querying database: ', err);
      return res.status(500).send('Database error');
    }

    if (result.length > 0) {
      // If login is successful, redirect to the admin page
      return res.redirect('/admin');
    } else {
      return res.status(401).send('Incorrect username or password');
    }
  });
});

// Admin page after successful login
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Handle form submission (image upload and details insertion)
app.post('/upload', upload.single('image'), async (req, res) => {
    const { category, title, brand } = req.body;
    const file = req.file;
    const folderName = category.replace(/\s+/g, '_'); // Sanitize category for folder name
    const fileName = file.originalname;
    const filePath = `Images/${folderName}/${fileName}`;
  
    // Upload image to AWS S3 using AWS SDK v3
    const uploadParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: filePath,
      Body: file.buffer,
      ContentType: file.mimetype,
    };
  
    try {
      const uploadCommand = new PutObjectCommand(uploadParams);
      const data = await s3.send(uploadCommand);
  
      console.log('File uploaded successfully', data); // Log response
      const s3Url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;
  
      console.log('Image Location:', s3Url); // Log the URL
  
      // Insert product details into MySQL database
      const query = 'INSERT INTO ' + category.replace(/\s+/g, '_') + ' (image_name, image_location, title, brand) VALUES (?, ?, ?, ?)';
      db.query(query, [fileName, s3Url, title, brand], (err, result) => {
        if (err) {
          console.log('Error inserting data into MySQL: ', err);
          return res.status(500).send('Error inserting data into database');
        }
        res.send('Product details uploaded successfully!');
      });
    } catch (err) {
      console.error('Error uploading image to S3:', err); // Log full error for debugging
      return res.status(500).send('Error uploading image');
    }
  });

  // Logout route
app.get('/logout', (req, res) => {
    // Logic for logout (e.g., clearing sessions or cookies)
    res.redirect('/');
  });
  

// Start the server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});
