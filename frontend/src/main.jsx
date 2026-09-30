import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";  
import ActionToastHost from "./components/ActionToast";
import "./index.css";
import "./components/VehicleImageFrame.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />  
    <ActionToastHost />
  </React.StrictMode>
);
