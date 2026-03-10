import mongoose from "mongoose";

const WALLET_INDEX_NAME = "walletAddress_1";

const ensureWalletAddressIndex = async () => {
  try {
    const usersCollection = mongoose.connection.collection("users");

    await usersCollection.updateMany(
      {
        $or: [{ walletAddress: null }, { walletAddress: "" }],
      },
      {
        $unset: { walletAddress: "" },
      }
    );

    const indexes = await usersCollection.indexes();
    const walletIndex = indexes.find((index) => index.name === WALLET_INDEX_NAME);

    if (walletIndex) {
      await usersCollection.dropIndex(WALLET_INDEX_NAME);
    }

    await usersCollection.createIndex(
      { walletAddress: 1 },
      {
        name: WALLET_INDEX_NAME,
        unique: true,
        sparse: true,
      }
    );

    console.log("Ensured users.walletAddress uses a unique sparse index.");
  } catch (error) {
    console.error("Failed to rebuild users.walletAddress index:", error.message);
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected successfully.");
    console.log(`Database: ${conn.connection.name}`);
    console.log(`Host: ${conn.connection.host}:${conn.connection.port}`);

    await ensureWalletAddressIndex();
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }
};

mongoose.connection.on("connected", () => {
  console.log("Mongoose connected to MongoDB");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("Mongoose disconnected from MongoDB");
});

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("MongoDB connection closed due to app termination");
  process.exit(0);
});

export default connectDB;
