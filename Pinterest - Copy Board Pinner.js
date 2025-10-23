// ==UserScript==
// @name         Pinterest - Copy Board, Pinner, Pin Actions
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Копирование автора и доски пина с визуальной подсказкой наличия данных
// @match        *://*.pinterest.com/pin/*
// @run-at       document-idle
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    // --- Извлечение данных пина ---
    function getPinData() {
        let pinData = {};
        try {
            const script = document.querySelector('#__PWS_INITIAL_PROPS__');
            if (!script) return pinData;

            const json = JSON.parse(script.textContent);
            const pins = json?.initialReduxState?.pins;
            if (pins) {
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
        } catch (e) {
            console.error('Pin data extraction failed', e);
        }
        return pinData;
    }

    const pinInfo = getPinData();

    // --- Копирование в буфер ---
    function copyToClipboard(text) {
        if (typeof GM_setClipboard !== 'undefined') {
            GM_setClipboard(text);
        } else {
            navigator.clipboard.writeText(text).catch(console.error);
        }
    }

    // --- Сообщение ---
    function showMessage(msg) {
        const div = document.createElement('div');
        div.textContent = msg;
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
            opacity: 0.9,
            pointerEvents: 'none',
            fontSize: '14px'
        });
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 2000);
    }

    // --- Создание кнопок ---
    function createButton(text, top, onClick, dataUrl, notFoundMsg) {
        const btn = document.createElement('button');
        btn.textContent = text;
        // Цвет и tooltip в зависимости от наличия данных
        if (dataUrl) {
            btn.style.background = 'lightgreen';
            btn.title = dataUrl;
        } else {
            btn.style.background = 'lightgray';
            btn.title = notFoundMsg;
        }
        Object.assign(btn.style, {
            position: 'fixed',
            top: top + 'px',
            right: '10px',
            zIndex: 99999,
            pointerEvents: 'auto',
            opacity: 1,
            padding: '5px 10px',
            border: '1px solid black',
            borderRadius: '4px',
            cursor: 'pointer'
        });
        btn.onclick = onClick;
        document.body.appendChild(btn);
        return btn;
    }

    // --- Действия кнопок ---
    function actionB() {
        if (pinInfo.boardUrl) {
            copyToClipboard(`Board: ${pinInfo.boardName} | ${pinInfo.boardUrl}`);
            window.open(pinInfo.boardUrl, '_blank');
            showMessage('Доска скопирована и открыта');
        } else {
            showMessage('Доска не найдена');
        }
    }

    function actionA() {
        if (pinInfo.pinnerUrl) {
            copyToClipboard(`Pinner: ${pinInfo.pinnerName} | ${pinInfo.pinnerUrl}`);
            window.open(pinInfo.pinnerUrl, '_blank');
            showMessage('Автор скопирован и открыт');
        } else {
            showMessage('Автор не найден');
        }
    }

    // --- Создание кнопок с динамическим состоянием ---
    createButton('B', 10, actionB, pinInfo.boardUrl, 'Доска не найдена');
    createButton('A', 50, actionA, pinInfo.pinnerUrl, 'Автор не найден');

    // --- Клавиши ---
    document.addEventListener('keydown', (e) => {
        if(e.key === 'a' || e.key === 'A') actionA();
        if(e.key === 'b' || e.key === 'B') actionB();
    });

})();
