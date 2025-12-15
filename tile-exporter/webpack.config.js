const path = require("path");

module.exports = {
  externals: {
  'sharp': 'commonjs sharp'
},
  mode: "development",                                 // or "production"
  target: "node",                                      // important
  entry: "./index.ts",
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "exporter.js"
  },
  resolve: {
    extensions: [".ts", ".js"]
  },
  module: {
    
    rules: [
      {
        test: /\.ts$/,
        loader: "ts-loader",
        exclude: /node_modules/
      }
    ]
  },
  devtool: "source-map"

  
};
