import React from 'react';
import { SettingsPanel } from '../../components/SettingsPanel';
import { nativeClient } from '../../native/native-client';

/**
 * Standalone floating tool window hosting TidyDesk application settings.
 */
export const SettingsWindowApp: React.FC = () => {
  const close = () => {
    if (nativeClient.isAvailable()) {
      nativeClient.windows.control('close-settings');
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden select-none">
      <SettingsPanel variant="window" onClose={close} />
    </div>
  );
};
