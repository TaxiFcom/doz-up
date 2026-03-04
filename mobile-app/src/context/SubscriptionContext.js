import React, { createContext, useContext, useState } from 'react';

const SubscriptionContext = createContext();

export function SubscriptionProvider({ children }) {
  const [subscription, setSubscription] = useState({
    plan: 'free',
    usage: 0,
  });

  return (
    <SubscriptionContext.Provider value={{ subscription }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
