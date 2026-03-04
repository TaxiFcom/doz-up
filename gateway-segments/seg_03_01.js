        }
        .image-container img {
            width: 100%;
            display: block;
            cursor: zoom-in;
            transition: transform 0.3s;
        }
        .image-container:hover img {
            transform: scale(1.02);
        }
        .image-info {
            padding: 15px 20px;
            background: rgba(0,0,0,0.3);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.85rem;
            color: rgba(255,255,255,0.6);
        }
        .image-actions {
            display: flex;
            gap: 10px;
        }
        .image-action-btn {
            background: rgba(255,255,255,0.1);
            border: none;
            color: #fff;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.8rem;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 5px;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
        }
        .image-action-btn:hover {
            background: rgba(124, 58, 237, 0.5);
        }
        .share-section {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
        }
        .share-title {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 15px;
            text-align: center;
        }
        .share-buttons {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 12px;
        }
        .share-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 16px;
            border-radius: 12px;
            border: none;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            color: #fff;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
            user-select: none;
            -webkit-user-select: none;
        }
        .share-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.3);
        }
        .share-btn:active {
            transform: translateY(-1px);
        }
        .share-btn.whatsapp { background: linear-gradient(135deg, #25D366, #128C7E); }
        .share-btn.telegram { background: linear-gradient(135deg, #0088cc, #005f99); }
        .share-btn.twitter { background: linear-gradient(135deg, #1DA1F2, #0d8bd9); }
        .share-btn.facebook { background: linear-gradient(135deg, #1877F2, #0d5fc2); }
        .share-btn.email { background: linear-gradient(135deg, #EA4335, #c5221f); }
        .share-btn.copy { background: linear-gradient(135deg, #7c3aed, #5b21b6); }
        .share-btn.download { background: linear-gradient(135deg, #10b981, #059669); }
        .share-btn.qr { background: linear-gradient(135deg, #6366f1, #4f46e5); }
        .share-btn svg { width: 20px; height: 20px; flex-shrink: 0; }
        .share-btn.copied { background: linear-gradient(135deg, #10b981, #059669) !important; }

        .invite-section {
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(16, 185, 129, 0.2));
            border: 1px solid rgba(124, 58, 237, 0.3);
            border-radius: 16px;
            padding: 30px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        .invite-section::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: radial-gradient(circle at 30% 30%, rgba(124, 58, 237, 0.15) 0%, transparent 50%),
                        radial-gradient(circle at 70% 70%, rgba(16, 185, 129, 0.1) 0%, transparent 50%);
            pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation: none !important; transition: none !important; }
        }
        .invite-content {
            position: relative;
            z-index: 1;
        }
        .invite-title {
            font-size: 1.3rem;
            font-weight: 700;
            margin-bottom: 10px;
        }
        .invite-text {
            color: rgba(255,255,255,0.7);
            margin-bottom: 20px;
            font-size: 0.95rem;
        }
        .invite-buttons {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .invite-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 14px 24px;
            border-radius: 12px;
            border: none;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            color: #fff;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
            user-select: none;
            -webkit-user-select: none;
        }
        .invite-btn.primary {
            background: linear-gradient(135deg, #7c3aed, #6366f1);
            box-shadow: 0 4px 15px rgba(124, 58, 237, 0.4);
        }
        .invite-btn.secondary {
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
        }
        .invite-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 30px rgba(124, 58, 237, 0.4);
        }

        .features-row {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-top: 15px;
            flex-wrap: wrap;
        }
        .feature-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85rem;
            color: rgba(255,255,255,0.6);
        }
        .feature-item svg {
            width: 16px;
            height: 16px;
            color: #10b981;
        }

        .footer {
            text-align: center;
            padding: 20px;
            color: rgba(255,255,255,0.4);
            font-size: 0.8rem;
        }
        .footer a {
            color: #7c3aed;
            text-decoration: none;
        }

        .toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: linear-gradient(135deg, #10b981, #059669);
            color: #fff;
            padding: 14px 28px;
            border-radius: 12px;
            font-weight: 600;
            opacity: 0;
            transition: all 0.3s;
            z-index: 1000;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 10px 40px rgba(16, 185, 129, 0.4);
        }
        .toast.show {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
        .toast svg {
            width: 20px;
            height: 20px;
        }

        /* Lightbox */
        .lightbox {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.95);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2000;
            cursor: zoom-out;
            padding: 20px;
        }
        .lightbox.show {
            display: flex;
        }
        .lightbox img {
            max-width: 95%;
            max-height: 95%;
            object-fit: contain;
            border-radius: 8px;
        }
        .lightbox-close {
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(255,255,255,0.1);
            border: none;
            color: #fff;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
        }
        .lightbox-close:hover {
            background: rgba(255,255,255,0.2);
        }

        /* QR Modal */
        .qr-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2000;
        }
        .qr-modal.show {
            display: flex;
        }
        .qr-content {
            background: #fff;
            padding: 30px;
            border-radius: 20px;
            text-align: center;
            max-width: 320px;
        }
        .qr-content h3 {
            color: #1a1a2e;
            margin-bottom: 15px;
        }
        .qr-content p {
            color: #666;
            font-size: 0.9rem;
            margin-bottom: 20px;
        }
        .qr-code {
            background: #fff;
            padding: 15px;
            border-radius: 12px;
            display: inline-block;
        }
        .qr-close {
            margin-top: 15px;
            background: linear-gradient(135deg, #7c3aed, #6366f1);
            border: none;
            color: #fff;
            padding: 12px 30px;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
        }

        /* Pairing Modal Styles */
        .pairing-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2000;
        }
        .pairing-modal.show {
            display: flex;
        }
        .pairing-content {
            background: linear-gradient(135deg, #1a1a2e, #2d2d44);
            padding: 30px;
            border-radius: 20px;
            text-align: center;
            max-width: 380px;
            width: 90%;
            border: 1px solid rgba(124, 58, 237, 0.3);
        }
        .pairing-content h3 {
            color: #fff;
            margin-bottom: 10px;
            font-size: 1.3rem;
        }
        .pairing-content p {
            color: #94a3b8;
            font-size: 0.9rem;
            margin-bottom: 20px;
        }
        .pairing-code-display {
            background: rgba(124, 58, 237, 0.2);
            border: 2px dashed rgba(124, 58, 237, 0.5);
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            cursor: pointer;
            transition: all 0.2s;
        }
        .pairing-code-display:hover {
            background: rgba(124, 58, 237, 0.3);
            border-color: rgba(124, 58, 237, 0.8);
        }
        .pairing-code {
            font-family: 'Courier New', monospace;
            font-size: 2rem;
            font-weight: 700;
            color: #fff;
            letter-spacing: 4px;
        }
        .pairing-code-hint {
            color: #94a3b8;
            font-size: 0.8rem;
            margin-top: 8px;
        }
        .pairing-timer {
            color: #f59e0b;
            font-size: 0.9rem;
            margin: 15px 0;
        }
        .pairing-divider {
            display: flex;
            align-items: center;
            margin: 20px 0;
            color: #64748b;
            font-size: 0.85rem;
        }
        .pairing-divider::before, .pairing-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: rgba(255,255,255,0.1);
        }
        .pairing-divider span {
            padding: 0 15px;
        }
        .pairing-input-section {
            margin-top: 15px;
        }
        .pairing-input {
            width: 100%;
            padding: 15px;
            font-size: 1.5rem;
            font-weight: 700;
            text-align: center;
            text-transform: uppercase;
            letter-spacing: 4px;
            border-radius: 12px;
            border: 2px solid rgba(139, 92, 246, 0.3);
            background: rgba(139, 92, 246, 0.1);
            color: #fff;
            outline: none;
            font-family: 'Courier New', monospace;
        }
        .pairing-input:focus {
            border-color: rgba(139, 92, 246, 0.8);
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
        }
        .pairing-btn {
            background: linear-gradient(135deg, #7c3aed, #6366f1);
            border: none;
            color: #fff;
            padding: 14px 30px;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            font-size: 1rem;
            margin-top: 15px;
            width: 100%;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
            transition: all 0.2s;
        }
        .pairing-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(124, 58, 237, 0.4);
        }
        .pairing-btn.secondary {
            background: rgba(255,255,255,0.1);
            margin-top: 10px;
        }
        .pairing-status {
            margin-top: 15px;
            padding: 10px;
            border-radius: 8px;
            font-size: 0.9rem;
        }
        .pairing-status.success {
            background: rgba(16, 185, 129, 0.2);
            color: #10b981;
        }
        .pairing-status.error {
            background: rgba(239, 68, 68, 0.2);
            color: #ef4444;
        }
        .pairing-tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        .pairing-tab {
            flex: 1;
            padding: 12px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            color: #94a3b8;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        .pairing-tab.active {
            background: rgba(124, 58, 237, 0.2);
            border-color: rgba(124, 58, 237, 0.5);
            color: #fff;
        }
        .pairing-tab-content {
            display: none;
        }
        .pairing-tab-content.active {
            display: block;
        }

        @media (max-width: 600px) {
            .share-buttons {
                grid-template-columns: repeat(2, 1fr);
            }
            .invite-buttons {
                flex-direction: column;
            }
