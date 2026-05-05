import React from "react";

interface LoadingSpinnerProps {
  loading: boolean;
  label?: string;
  size?: "sm" | "md" | "lg";
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  loading,
  label = "Loading…",
  size = "md",
}) => {
  if (!loading) return null;

  return (
    <div className="loading-spinner">
      <div className={`spinner${size === "lg" ? " spinner-lg" : ""}`} />
      {label && <span className="loading-text">{label}</span>}
    </div>
  );
};

export default LoadingSpinner;
