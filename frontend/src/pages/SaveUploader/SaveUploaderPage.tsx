import React, { useCallback, useEffect, useRef, useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './SaveUploaderPage.scss';

const SESSION_SAVE_DATA_KEY = 'emulator_save_data';
const SESSION_SAVE_NAME_KEY = 'emulator_save_name';

interface SaveInfo {
  name: string;
  data: Uint8Array;
}

const SaveUploaderPage: React.FC = () => {
  const [saveInfo, setSaveInfo] = useState<SaveInfo | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // On mount, check if the emulator already synced a save via sessionStorage.
  // This is the same entry point as a manual file upload — both call processSave.
  useEffect(() => {
    const b64 = sessionStorage.getItem(SESSION_SAVE_DATA_KEY);
    const name = sessionStorage.getItem(SESSION_SAVE_NAME_KEY);
    if (b64 && name) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      processSaveData(bytes, name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Central function — receives the raw bytes however they arrived.
  // The site owner can extend this to run their parse logic.
  const processSaveData = useCallback((bytes: Uint8Array, name: string) => {
    setError(null);
    setSaveInfo({ name, data: bytes });
  }, []);

  const processSaveFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        processSaveData(bytes, file.name);
      };
      reader.onerror = () => setError('Failed to read file.');
      reader.readAsArrayBuffer(file);
    },
    [processSaveData],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processSaveFile(file);
    },
    [processSaveFile],
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processSaveFile(file);
    e.target.value = '';
  };

  const handleClear = () => {
    setSaveInfo(null);
    setError(null);
    sessionStorage.removeItem(SESSION_SAVE_DATA_KEY);
    sessionStorage.removeItem(SESSION_SAVE_NAME_KEY);
  };

  return (
    <div className="save-uploader-page">
      <Header />
      <main className="save-uploader-main">
        <h1 className="save-uploader-title">Save File Reader</h1>

        {!saveInfo ? (
          <div className="save-uploader-picker">
            <p className="save-uploader-subtitle">
              Upload a save file to view your data, or save in the{' '}
              <a href="/Emulator">emulator</a> and it will appear here automatically.
            </p>

            <div
              className={`save-dropzone${isDragging ? ' dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              aria-label="Select a save file"
            >
              <svg
                className="save-dropzone-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M12 2v13M9 12l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" />
              </svg>
              <p className="save-dropzone-label">Drop save file here, or click to browse</p>
              <p className="save-dropzone-hint">.sav · .sa1 · .sa2 · .srm</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".sav,.sa1,.sa2,.srm"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {error && <p className="save-uploader-error">{error}</p>}
          </div>
        ) : (
          <div className="save-data-view">
            <div className="save-info-bar">
              <span className="save-file-name">{saveInfo.name}</span>
              <span className="save-file-size">
                {saveInfo.data.length >= 1024
                  ? `${(saveInfo.data.length / 1024).toFixed(1)} KB`
                  : `${saveInfo.data.length} B`}
              </span>
              <button className="save-clear-btn" onClick={handleClear}>
                Load Different Save
              </button>
            </div>

            {/* ── Parsed data panels go here ────────────────────────────── */}
            <div className="save-parsed-placeholder">
              <p>
                Save loaded successfully ({saveInfo.data.length.toLocaleString()} bytes).
                Parser output will appear here.
              </p>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default SaveUploaderPage;
