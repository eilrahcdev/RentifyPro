import { io } from "socket.io-client";

const SOCKET_URL = "http://localhost:5000";
let socketInstance = null;

export const getSocket = () => {
  const token = localStorage.getItem("token");
  if (!token) return null;

  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      autoConnect: true,
      transports: ["websocket"],
      auth: { token },
    });
  } else if (socketInstance.auth?.token !== token) {
    socketInstance.auth = { token };
    if (!socketInstance.connected) socketInstance.connect();
  }

  return socketInstance;
};

export const disconnectSocket = () => {
  if (!socketInstance) return;
  socketInstance.disconnect();
  socketInstance = null;
};

