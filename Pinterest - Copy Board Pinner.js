// ==UserScript==
// @name         Pinterest - Copy Board, Pinner, Pin Actions (Fetch interceptor)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Перехват fetch-запросов для получения данных пинов
// @match        *://*.pinterest.com/pin/*
// @run-at       document-start
// @grant        GM_setClipboard
// ==/UserScript==
(function() {
    'use strict';

    // Кеш данных пинов
    const pinCache = new Map();

    // ---------- Перехват XHR ----------
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try {
                const url = this._url;

                if (url && (url.includes('/resource/') || url.includes('query') || url.includes('pin'))) {
                    const contentType = this.getResponseHeader('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const data = JSON.parse(this.responseText);

                        const pinData = extractPinFromResponse(data);
                        if (pinData && pinData.id) {
                            pinCache.set(String(pinData.id), pinData);

                            const currentPinId = getPinIdFromUrl();

                            if (String(pinData.id) === String(currentPinId)) {
                                setTimeout(() => updateUIFromCache(currentPinId), 100);
                            }
                        }
                    }
                }
            } catch(e) {
                // Игнорируем ошибки
            }
        });
        return originalXHRSend.apply(this, args);
    };

    // ---------- Перехват fetch ----------
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);

        const clonedResponse = response.clone();

        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

            if (url && (url.includes('/resource/') || url.includes('query') || url.includes('pin'))) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const data = await clonedResponse.json();

                    const pinData = extractPinFromResponse(data);
                    if (pinData && pinData.id) {
                        pinCache.set(String(pinData.id), pinData);

                        const currentPinId = getPinIdFromUrl();
                        if (String(pinData.id) === String(currentPinId)) {
                            setTimeout(() => updateUIFromCache(currentPinId), 100);
                        }
                    }
                }
            }
        } catch(e) {
            // Игнорируем ошибки
        }

        return response;
    };

    function extractPinFromResponse(data) {
        function findPin(obj, depth = 0) {
            if (!obj || typeof obj !== 'object' || depth > 10) return null;

            if (obj.id && obj.board && obj.pinner) {
                return obj;
            }

            if (obj.id && (obj.board_id || obj.boardId)) {
                return obj;
            }

            const paths = [
                'resource_response.data',
                'resource_response.data.pin',
                'data',
                'data.pin',
                'pin',
                'pins',
                'results'
            ];

            for (const path of paths) {
                const parts = path.split('.');
                let current = obj;
                for (const part of parts) {
                    current = current?.[part];
                    if (!current) break;
                }
                if (current) {
                    const result = findPin(current, depth + 1);
                    if (result) return result;
                }
            }

            if (Array.isArray(obj)) {
                for (const item of obj) {
                    const result = findPin(item, depth + 1);
                    if (result) return result;
                }
            }

            for (const key in obj) {
                if (key === 'pin' || key === 'data' || key === 'pins' || key === 'results') {
                    const result = findPin(obj[key], depth + 1);
                    if (result) return result;
                }
            }

            return null;
        }

        return findPin(data);
    }

    // ---------- helpers ----------
    function getPinIdFromUrl(url = location.href) {
        const m = url.match(/\/pin\/(\d+)(?:\/|$)/);
        return m ? m[1] : null;
    }

    function getPinDataFromCache(pinId) {
        const cached = pinCache.get(String(pinId));
        if (cached) {
            return {
                pinId: cached.id,
                boardName: cached.board?.name || '',
                boardUrl: cached.board?.url ? `https://pinterest.com${cached.board.url}` : '',
                pinnerName: cached.pinner?.full_name || cached.pinner?.username || '',
                pinnerUrl: cached.pinner?.username ? `https://pinterest.com/${cached.pinner.username}/` : ''
            };
        }
        return null;
    }

    function getPinDataFromScript(targetPinId = null) {
        let pinData = {};
        try {
            const script = document.querySelector('#__PWS_INITIAL_PROPS__');
            if (!script) return pinData;
            const json = JSON.parse(script.textContent);
            const pins = json?.initialReduxState?.pins;
            if (pins) {
                if (targetPinId) {
                    const pin = pins[targetPinId];
                    if (pin) {
                        pinData = {
                            pinId: pin.id,
                            boardName: pin.board?.name || '',
                            boardUrl: pin.board?.url ? `https://pinterest.com${pin.board.url}` : '',
                            pinnerName: pin.pinner?.full_name || pin.pinner?.username || '',
                            pinnerUrl: pin.pinner?.username ? `https://pinterest.com/${pin.pinner.username}/` : ''
                        };
                    }
                } else {
                    const keys = Object.keys(pins);
                    if (keys.length) {
                        const pin = pins[keys[0]];
                        pinData = {
                            pinId: pin.id,
                            boardName: pin.board?.name || '',
                            boardUrl: pin.board?.url ? `https://pinterest.com${pin.board.url}` : '',
                            pinnerName: pin.pinner?.full_name || pin.pinner?.username || '',
                            pinnerUrl: pin.pinner?.username ? `https://pinterest.com/${pin.pinner.username}/` : ''
                        };
                    }
                }
            }
        } catch (e) {
            console.error('Pin data extraction failed', e);
        }
        return pinData;
    }

    function copyToClipboard(text) {
        if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(text);
        else navigator.clipboard.writeText(text).catch(console.error);
    }

    function showMessage(msg) {
        const id = '__pin_buttons_toast__';
        let div = document.getElementById(id);
        if (!div) {
            div = document.createElement('div');
            div.id = id;
            Object.assign(div.style, {
                position: 'fixed',
                top: '10px',
                right: '50%',
                transform: 'translateX(50%)',
                background: 'black',
                color: 'white',
                padding: '8px 12px',
                borderRadius: '4px',
                zIndex: 99999,
                opacity: 0.95,
                pointerEvents: 'none',
                fontSize: '14px'
            });
            document.body.appendChild(div);
        }
        div.textContent = msg;
        clearTimeout(div._to);
        div._to = setTimeout(() => { if(div) div.remove(); }, 2000);
    }

    function createButton(text, top, tooltip, id) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.textContent = text;
        btn.title = tooltip;
        Object.assign(btn.style, {
            position: 'fixed',
            top: top + 'px',
            right: '10px',
            zIndex: 99999,
            background: '#ccc',
            color: 'black',
            padding: '5px 10px',
            border: '1px solid #666',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background 0.25s, transform 0.15s'
        });
        document.body.appendChild(btn);
        return btn;
    }

    function setButtonColor(btn, color) {
        const colors = { yellow: '#ffd633', green: '#4caf50', gray: '#ccc' };
        if (!btn) return;
        btn.style.background = colors[color] || '#ccc';
    }

    // ---------- UI ----------
    let btnB, btnA, pinInfo;

    function initUI() {
        if (btnB) return; // Уже инициализировано

        btnB = createButton('B', 10, 'Доска', 'btnBoard');
        btnA = createButton('A', 50, 'Автор', 'btnAuthor');

        const currentPinId = getPinIdFromUrl();
        pinInfo = getPinDataFromCache(currentPinId) || getPinDataFromScript(currentPinId);

        btnB.title = pinInfo?.boardUrl || 'Доска не найдена';
        btnA.title = pinInfo?.pinnerUrl || 'Автор не найден';
        setButtonColor(btnB, pinInfo?.boardUrl ? 'green' : 'gray');
        setButtonColor(btnA, pinInfo?.pinnerUrl ? 'green' : 'gray');

        btnB.addEventListener('click', actionB);
        btnA.addEventListener('click', actionA);

        document.addEventListener('keydown', e => {
            if (e.key === 'a' || e.key === 'A') actionA();
            if (e.key === 'b' || e.key === 'B') actionB();
        });
    }

    function actionB() {
        if (pinInfo?.boardUrl) {
            copyToClipboard(`Board: ${pinInfo.boardName} | ${pinInfo.boardUrl}`);
            window.open(pinInfo.boardUrl, '_blank');
            showMessage('Доска скопирована и открыта');
        } else showMessage('Доска не найдена');
    }

    function actionA() {
        if (pinInfo?.pinnerUrl) {
            copyToClipboard(`Pinner: ${pinInfo.pinnerName} | ${pinInfo.pinnerUrl}`);
            window.open(pinInfo.pinnerUrl, '_blank');
            showMessage('Автор скопирован и открыт');
        } else showMessage('Автор не найден');
    }

    function updateUIFromCache(pinId) {
        pinInfo = getPinDataFromCache(pinId);

        if (!pinInfo) return;

        if (btnB && btnA) {
            btnB.title = pinInfo.boardUrl || 'Доска не найдена';
            btnA.title = pinInfo.pinnerUrl || 'Автор не найден';
            setButtonColor(btnB, pinInfo.boardUrl ? 'green' : 'gray');
            setButtonColor(btnA, pinInfo.pinnerUrl ? 'green' : 'gray');
        }
    }

    // ---------- SPA watcher ----------
    let lastPinId = getPinIdFromUrl();

    function handleNavigation() {
        const newPinId = getPinIdFromUrl();
        if (newPinId && newPinId !== lastPinId) {
            lastPinId = newPinId;

            if (btnB && btnA) {
                setButtonColor(btnB, 'yellow');
                setButtonColor(btnA, 'yellow');
            }

            // Проверяем кеш
            const cached = getPinDataFromCache(newPinId);
            if (cached) {
                updateUIFromCache(newPinId);
            }
        }
    }

    // перехват history API
    (function patchHistory() {
        const origPush = history.pushState;
        const origReplace = history.replaceState;
        history.pushState = function() {
            const ret = origPush.apply(this, arguments);
            handleNavigation();
            return ret;
        };
        history.replaceState = function() {
            const ret = origReplace.apply(this, arguments);
            handleNavigation();
            return ret;
        };
        window.addEventListener('popstate', handleNavigation);
    })();

    // Инициализация после загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }
})();