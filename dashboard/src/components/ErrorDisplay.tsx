import React from "react";

interface ErrorDisplayProps {
  message: string | null;
  onClose?: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ message, onClose }) => {
  if (!message) return null;
  
  return (
    <div className="error-display">
      <div className="error-content">
        <span className="error-icon">⚠</span>
        <span className="error-message">{message}</span>
        {onClose && (
          <button className="error-close" onClick={onClose}>
            ×
          </button>
        )}
      </div>
    </div>
  );
};

export default ErrorDisplay;