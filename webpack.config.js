const path = require("path");

module.exports = {
  mode: "development",

  entry: "./src/index.ts",

  output: {
    filename: "main.js",
    path: path.resolve(__dirname, "dist"),
    clean: true,
  },

  resolve: {
    extensions: [".ts", ".js"], // allow import without extensions
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },

  devServer: {
    static: {
      directory: path.join(__dirname, "public"),
    },
    hot: true,
    open: true,
    port: 3000,
  },
};
