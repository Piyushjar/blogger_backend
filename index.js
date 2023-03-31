const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const User = require("./models/User");
const Post = require("./models/Post");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

const storage = new multer.memoryStorage();
const upload = multer({
  storage,
});

const app = express();

async function handleUpload(file) {
  const res = await cloudinary.uploader.upload(file, {
    folder: "blogger",
    resource_type: "auto",
  });
  return res;
}

async function handleDelete(id) {
  await cloudinary.uploader.destroy(id, function (error, result) {
    console.log(result, error);
  });
}

const salt = bcrypt.genSaltSync(10);
const secret = process.env.JWT_SECRET;

app.use(cors({ credentials: true, origin: "http://localhost:3000" }));
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(__dirname + "/uploads"));

mongoose.connect(process.env.DB_URL);

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const newUser = await User.create({
      username,
      password: bcrypt.hashSync(password, salt),
    });
    res.json(newUser);
  } catch (error) {
    res.status(400).json(error.message);
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json("User doesn't exists.");
  const passOk = bcrypt.compareSync(password, user.password);
  if (passOk) {
    //login
    jwt.sign({ username, id: user._id }, secret, {}, (err, token) => {
      if (err) throw err;
      res.cookie("token", token).json({
        id: user._id,
        username,
      });
    });
  } else {
    res.status(400).json("Wrong Credentials.❌");
  }
});

app.get("/profile", (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, secret, {}, (error, info) => {
    if (error) throw error;
    res.json(info);
  });
});

app.post("/logout", (req, res) => {
  res.cookie("token", "").json("Logged out successfully.");
});

app.post("/post", upload.single("file"), async (req, res) => {
  try {
    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (error, info) => {
      if (error) throw error;
      const b64 = Buffer.from(req.file.buffer).toString("base64");
      let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
      const cldRes = await handleUpload(dataURI);
      const { title, summary, content } = req.body;
      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover: { url: cldRes.secure_url, id: cldRes.public_id },
        author: info.id,
      });
      res.json(postDoc);
    });
  } catch (error) {
    res.send({
      message: error.message,
    });
  }
});

app.get("/post", async (req, res) => {
  const posts = await Post.find()
    .populate("author", ["username"])
    .sort({ createdAt: -1 })
    .limit(20);
  res.json(posts);
});

app.get("/post/:id", async (req, res) => {
  const { id } = req.params;
  const postDoc = await Post.findById(id).populate("author", ["username"]);
  res.json(postDoc);
});

app.put("/post", upload.single("file"), async (req, res) => {
  try {
    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (error, info) => {
      if (error) throw error;
      let newPath, newId;
      if (req.file) {
        const b64 = Buffer.from(req.file.buffer).toString("base64");
        let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
        const cldRes = await handleUpload(dataURI);
        newPath = cldRes.secure_url;
        newId = cldRes.public_id;
      }
      const { id, title, summary, content } = req.body;
      const postDoc = await Post.findById(id);
      const isAuthor =
        JSON.stringify(postDoc.author) === JSON.stringify(info.id);
      if (!isAuthor) {
        return res.status(400).json("You are not the author.");
      }
      if (newId) await handleDelete(postDoc.cover.id);
      await postDoc.updateOne({
        title,
        summary,
        content,
        cover: {
          url: newPath ? newPath : postDoc.cover.url,
          id: newId ? newId : postDoc.cover.id,
        },
        author: info.id,
      });
      res.json(postDoc);
    });
  } catch (error) {
    res.send({ message: error.message });
  }
});

app.delete("/post/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findById(id);
    if (!post) res.status(400).json("post does not exist");
    const oldId = post.cover.id;
    await post.delete();
    await handleDelete(oldId);
    res.status(200).json("post successfully deleted");
  } catch (error) {
    res.send({ message: error.message });
  }
});

app.get("/", (req, res) => {
  res.send("Server running");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, console.log("Listening 🚀"));

module.exports = app;
