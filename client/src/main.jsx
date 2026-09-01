import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MsalProvider } from '@azure/msal-react';
import { ProductConfigProvider } from './ProductConfigContext';
import { AuthProvider } from './AuthContext';
import { msalInstance } from './msalConfig';
import { handleMicrosoftCallback } from './msalOauth';
import App from './App';
import './index.css';
import { installApiAuth } from './apiAuth';

// Must run before any request is made, so writes carry the user identity that
// version history records as "updated by".
installApiAuth();

msalInstance.initialize().then(async () => {
  let msRedirectToken = null;
  let msRedirectError = null;

  // Handle custom PKCE OAuth callback (bypasses MSAL's cross-origin token exchange)
  try {
    const callbackData = await handleMicrosoftCallback();
    if (callbackData) {
      const res = await fetch('/api/auth/microsoft/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callbackData),
      });
      const data = await res.json();
      if (data.token) {
        msRedirectToken = data.token;
      } else {
        msRedirectError = data.error || 'Microsoft sign-in failed';
      }
    }
  } catch (err) {
    if (err.message && !err.message.includes('state mismatch')) {
      msRedirectError = err.message;
    }
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <MsalProvider instance={msalInstance}>
      <BrowserRouter>
        <AuthProvider msRedirectToken={msRedirectToken} msRedirectError={msRedirectError}>
          <ProductConfigProvider>
            <App />
          </ProductConfigProvider>
        </AuthProvider>
      </BrowserRouter>
    </MsalProvider>
  );
});
