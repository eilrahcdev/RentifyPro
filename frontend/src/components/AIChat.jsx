import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

export default function AIChat({ isOpen, onClose }) {
  const [userMessage, setUserMessage] = useState("");
  const [messages, setMessages] = useState([
    { sender: "ai", text: "Hi! 👋 This is RentifyPro AI. How can I assist you today?" },
  ]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMessages([{ sender: "ai", text: "Hi! 👋 This is RentifyPro AI. How can I assist you today?" }]);
  }, [isOpen]);

  const handleSendMessage = () => {
    if (!userMessage.trim()) return;

    setMessages((prev) => [...prev, { sender: "user", text: userMessage }]);
    setUserMessage("");
    setIsTyping(true);

    setTimeout(() => {
      setMessages((prev) => [...prev, { sender: "ai", text: "Got it! 😊 Let me help you with that." }]);
      setIsTyping(false);
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 w-[95vw] sm:w-[400px] h-[70vh] sm:h-[450px] bg-white rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col animate-slideUp">
      {/* header */}
      <div className="bg-[#017FE6] text-white px-4 py-3 flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-sm">RentifyPro AI</h3>
          <p className="text-xs opacity-80">Online • Ready to help</p>
        </div>
        <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-colors duration-300">
          <X size={20} />
        </button>
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 space-y-4">
        {messages.map((msg, index) => (
          <Message key={index} message={msg} />
        ))}
        {isTyping && <TypingIndicator />}
      </div>

      {/* input */}
      <div className="border-t bg-white px-3 py-2 flex items-center gap-2">
        <input
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
          placeholder="Ask me about vehicles, bookings..."
          className="flex-1 border rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-[#017FE6] focus:outline-none transition-all duration-300"
        />
        <button onClick={handleSendMessage} className="bg-[#017FE6] text-white w-9 h-9 rounded-full hover:bg-[#0165B8] transition-all duration-300 hover:scale-110 flex items-center justify-center">
          ➤
        </button>
      </div>
    </div>
  );
}

function Message({ message }) {
  return (
    <div className={`flex items-end gap-2 ${message.sender === "user" ? "justify-end" : "justify-start"} animate-fadeIn`}>
      {message.sender === "ai" && (
        <img src="/robot-ai.png" alt="AI" className="w-8 h-8 rounded-full" />
      )}

      <div className={`px-4 py-2 rounded-2xl text-sm max-w-[75%] shadow transition-all duration-300 ${
        message.sender === "user"
          ? "bg-[#017FE6] text-white rounded-br-sm"
          : "bg-white text-gray-800 rounded-bl-sm"
      }`}>
        {message.text}
      </div>

      {message.sender === "user" && (
        <div className="w-8 h-8 rounded-full bg-[#017FE6] text-white flex items-center justify-center text-xs font-bold">
          U
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 animate-fadeIn">
      <img src="/robot-ai.png" alt="AI" className="w-8 h-8 rounded-full" />
      <div className="bg-white px-4 py-2 rounded-2xl shadow text-sm text-gray-500 flex gap-1">
        <span className="animate-bounce">.</span>
        <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
        <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
      </div>
    </div>
  );
}
