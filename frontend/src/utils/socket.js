import { io } from "socket.io-client";
import { SOCKET_URL, SOCKET_TRANSPORTS } from "./runtimeConfig";

let socketInstance = null;

export const getSocket = () => {
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      autoConnect: true,
      transports: SOCKET_TRANSPORTS,
      withCredentials: true,
    });
  } else if (!socketInstance.connected) {
    socketInstance.connect();
  }

  return socketInstance;
};

export const disconnectSocket = () => {
  if (!socketInstance) return;
  socketInstance.disconnect();
  socketInstance = null;
};

export const reconnectSocket = () => {
  if (!socketInstance) return;
  socketInstance.disconnect();
  socketInstance.connect();
};

