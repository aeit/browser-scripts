// ==UserScript==
// @name         Pinterest - Copy Board, Pinner, Pin Actions (Fetch interceptor)
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Перехват fetch-запросов для получения данных пинов с логированием и пересозданием кнопок
// @match        *://*.pinterest.com/pin/*
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // Конфигурация логирования
    const config = {
        enableLogging: GM_getValue('enableLogging', false)
    };

    // Функция логирования
    const log = (...args) => config.enableLogging && console.log('[PinCopy]', ...args);

    // Меню для вкл/выкл логирования
    GM_registerMenuCommand('Логирование: ' + (config.enableLogging ? 'Вкл' : 'Выкл'), () => {
        config.enableLogging = !config.enableLogging;
        GM_setValue('enableLogging', config.enableLogging);
        showMessage('Логирование: ' + (config.enableLogging ? 'Вкл' : 'Выкл'));
    });

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
                        log('XHR response:', url, data);

                        const pinData = extractPinFromResponse(data);
                        if (pinData && pinData.id) {
                            log('Pin extracted:', pinData.id);
                            pinCache.set(String(pinData.id), pinData);

                            const currentPinId = getPinIdFromUrl();

                            if (String(pinData.id) === String(currentPinId)) {
                                updateUIFromCache(currentPinId);
                            }
                        }
                    }
                }
            } catch(e) {
                log('Error in XHR handling:', e);
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
                    log('Fetch response:', url, data);

                    const pinData = extractPinFromResponse(data);
                    if (pinData && pinData.id) {
                        log('Pin extracted:', pinData.id);
                        pinCache.set(String(pinData.id), pinData);

                        const currentPinId = getPinIdFromUrl();
                        if (String(pinData.id) === String(currentPinId)) {
                            updateUIFromCache(currentPinId);
                        }
                    }
                }
            }
        } catch(e) {
            log('Error in fetch handling:', e);
        }

        return response;
    };

    function extractPinFromResponse(data) {
        log('Extracting pin from response:', data);
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
            log('Pin data from cache:', pinId, cached);
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
            log('Pin data from script:', pinData);
        } catch (e) {
            log('Pin data extraction failed:', e);
        }
        return pinData;
    }

    function copyToClipboard(text) {
        if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(text);
        else navigator.clipboard.writeText(text).catch(e => log('Clipboard error:', e));
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
            log('Copying board:', pinInfo.boardUrl);
            copyToClipboard(`Board: ${pinInfo.boardName} | ${pinInfo.boardUrl}`);
            window.open(pinInfo.boardUrl, '_blank');
            showMessage('Доска скопирована и открыта');
        } else {
            log('Board not found for pin:', pinInfo?.pinId);
            showMessage('Доска не найдена');
        }
    }

    function actionA() {
        if (pinInfo?.pinnerUrl) {
            log('Copying author:', pinInfo.pinnerUrl);
            copyToClipboard(`Pinner: ${pinInfo.pinnerName} | ${pinInfo.pinnerUrl}`);
            window.open(pinInfo.pinnerUrl, '_blank');
            showMessage('Автор скопирован и открыт');
        } else {
            log('Author not found for pin:', pinInfo?.pinId);
            showMessage('Автор не найден');
        }
    }

    function updateUIFromCache(pinId) {
        log('Updating UI for pin:', pinId);
        pinInfo = getPinDataFromCache(pinId);

        if (!pinInfo) return;

        if (btnB && btnA) {
            btnB.title = pinInfo.boardUrl || 'Доска не найдена';
            btnA.title = pinInfo.pinnerUrl || 'Автор не найден';
            setButtonColor(btnB, pinInfo.boardUrl ? 'green' : 'gray');
            setButtonColor(btnA, pinInfo.pinnerUrl ? 'green' : 'gray');
        }
    }

    // ---------- Удаление старых кнопок ----------
    function removeOldButtons() {
        ['btnBoard', 'btnAuthor', '__pin_buttons_toast__'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    }

    // ---------- SPA watcher ----------
    let lastPinId = getPinIdFromUrl();

    function handleNavigation() {
        const newPinId = getPinIdFromUrl();
        if (newPinId && newPinId !== lastPinId) {
            log('Navigation to new pin:', newPinId);
            lastPinId = newPinId;

            // Удаляем старые кнопки и пересоздаём
            removeOldButtons();
            btnB = null;
            btnA = null;
            initUI();

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