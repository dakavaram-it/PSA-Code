import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminConsole from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AdminConsole />
  </React.StrictMode>
);
