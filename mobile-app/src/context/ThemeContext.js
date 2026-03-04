import React, { createContext, useContext, useState } from 'react';

const ThemeContext = createContext();

const darkTheme = {
  background: '#0a0a12',
  card: 'rgba(255,255,255,0.03)',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#6366f1',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  border: 'rgba(255,255,255,0.08)',
};

export function ThemeProvider({ children }) {
  const [theme] = useState(darkTheme);

  return (
    <ThemeContext.Provider value={{ theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
