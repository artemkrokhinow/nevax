// NEVAX WebRTC - STABLE VERSION 2.0
// Video calls, audio calls, device selection, 100% reliability

// ==================== CONFIGURATION ====================
const CONFIG = {
    signalingServer: 'http://localhost:3000',
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ],
    maxRetries: 3,
    retryDelay: 2000,
    connectionTimeout: 30000
};

// ==================== STATE ====================
var state = {
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    socket: null,
    myId: null,
    targetId: null,
    isInitiator: false,
    inCall: false,
    videoEnabled: false,
    reconnectAttempts: 0,
    callStartTime: null,
    statsInterval: null,
    heartbeatInterval: null
};

// ==================== DEVICE SETTINGS ====================
var deviceSettings = {
    microphone: '',
    camera: '',
    audioOutput: '',
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    videoQuality: '640x480',
    frameRate: 30
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Nevax initializing...');
    initConnection();
    loadSettings();
    loadContacts();
    loadCallHistory();
    enumerateDevices();
    setupEventListeners();
    
    // Update version display
    var versionEl = document.getElementById('appVersion');
    if (versionEl) versionEl.textContent = 'v2.0';
});

// ==================== CONNECTION ====================
function initConnection() {
    var myIdInput = document.getElementById('myIdInput');
    state.myId = myIdInput?.value || 'user_' + Math.floor(Math.random() * 10000);
    if (myIdInput) myIdInput.value = state.myId;

    try {
        state.socket = io(CONFIG.signalingServer, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            timeout: 20000
        });

        state.socket.on('connect', function() {
            console.log('✅ Connected to server');
            state.socket.emit('register', state.myId);
            showNotification('Connected', 'Ready for calls');
        });

        state.socket.on('connect_error', function(err) {
            console.error('❌ Connection error:', err.message);
            showNotification('Connection Error', err.message);
        });

        state.socket.on('signal', handleSignal);
        
        state.socket.on('user-connected', function(id) {
            console.log('👤 User connected:', id);
            updateContactStatus(id, 'online');
        });
        
        state.socket.on('user-disconnected', function(id) {
            console.log('👋 User disconnected:', id);
            updateContactStatus(id, 'offline');
            if (state.targetId === id) endCall();
        });

        // Heartbeat
        state.heartbeatInterval = setInterval(function() {
            if (state.socket?.connected) {
                state.socket.emit('ping', Date.now());
            }
        }, 5000);

    } catch (err) {
        console.error('Failed to initialize connection:', err);
        showNotification('Error', 'Failed to connect to server');
    }
}

// ==================== CALL HANDLING ====================
window.handleCall = async function(e) {
    if (e) e.stopPropagation();
    
    if (state.inCall) {
        await endCall();
    } else {
        await startCallWithChecks();
    }
};

async function startCallWithChecks() {
    var friendInput = document.getElementById('friendIdInput');
    state.targetId = friendInput?.value?.trim();
    
    if (!state.targetId) {
        alert('❌ Enter friend ID!');
        return;
    }
    
    if (state.targetId === state.myId) {
        alert('❌ Cannot call yourself!');
        return;
    }
    
    // Pre-call device test
    var testResults = await testDevicesBeforeCall();
    if (!testResults.audio && !testResults.video) {
        alert('❌ No working devices found! Check settings.');
        return;
    }
    
    showNotification('Calling', 'Connecting to ' + state.targetId + '...');
    
    try {
        await startCall();
    } catch (err) {
        console.error('Call failed:', err);
        showNotification('Call Failed', err.message);
    }
}

async function startCall() {
    state.isInitiator = true;
    state.reconnectAttempts = 0;
    
    // Create peer connection with retry
    var pc = await createPeerConnectionWithRetry();
    if (!pc) {
        throw new Error('Failed to create peer connection');
    }
    
    state.peerConnection = pc;
    
    // Get local stream with selected devices
    try {
        var constraints = {
            audio: getAudioConstraints(),
            video: state.videoEnabled ? getVideoConstraints() : false
        };
        
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Apply audio output if set
        if (deviceSettings.audioOutput) {
            applyAudioOutput(deviceSettings.audioOutput);
        }
        
        // Add tracks to peer connection
        state.localStream.getTracks().forEach(function(track) {
            state.peerConnection.addTrack(track, state.localStream);
        });
        
        // Update UI
        updateLocalVideo();
        
    } catch (err) {
        console.error('Failed to get media:', err);
        throw new Error('Camera/Microphone access denied');
    }
    
    // Create and send offer
    try {
        var offer = await state.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: state.videoEnabled
        });
        
        await state.peerConnection.setLocalDescription(offer);
        
        // Wait for ICE gathering
        await waitForIceGathering();
        
        // Send offer
        state.socket.emit('signal', {
            to: state.targetId,
            from: state.myId,
            type: 'offer',
            sdp: state.peerConnection.localDescription,
            video: state.videoEnabled
        });
        
        // Start call timer
        state.callStartTime = Date.now();
        startStatsUpdate();
        
        // Update UI
        setCallUI(true);
        addCallToHistory(state.targetId, 'outgoing', false);
        
    } catch (err) {
        console.error('Offer failed:', err);
        cleanupCall();
        throw err;
    }
}

async function handleSignal(data) {
    console.log('📡 Signal:', data.type, 'from:', data.from);
    
    switch (data.type) {
        case 'offer':
            await handleOffer(data);
            break;
        case 'answer':
            await handleAnswer(data);
            break;
        case 'ice-candidate':
            await handleIceCandidate(data);
            break;
        case 'chat':
            handleChatMessage(data);
            break;
        case 'hangup':
            handleRemoteHangup();
            break;
        case 'video-toggle':
            handleRemoteVideoToggle(data.enabled);
            break;
    }
}

async function handleOffer(data) {
    state.targetId = data.from;
    state.isInitiator = false;
    state.videoEnabled = data.video || false;
    
    // Auto-answer if enabled
    var autoAnswer = document.getElementById('settingAutoAnswer')?.checked;
    if (!autoAnswer) {
        var accept = confirm('📞 Incoming call from ' + data.from + '\nAccept?');
        if (!accept) {
            state.socket.emit('signal', { to: state.targetId, from: state.myId, type: 'hangup' });
            return;
        }
    }
    
    try {
        // Create peer connection
        state.peerConnection = await createPeerConnectionWithRetry();
        
        // Get local stream
        var constraints = {
            audio: getAudioConstraints(),
            video: state.videoEnabled ? getVideoConstraints() : false
        };
        
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        state.localStream.getTracks().forEach(function(track) {
            state.peerConnection.addTrack(track, state.localStream);
        });
        
        updateLocalVideo();
        
        // Set remote description
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        
        // Create answer
        var answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        
        await waitForIceGathering();
        
        // Send answer
        state.socket.emit('signal', {
            to: state.targetId,
            from: state.myId,
            type: 'answer',
            sdp: state.peerConnection.localDescription
        });
        
        state.callStartTime = Date.now();
        startStatsUpdate();
        setCallUI(true);
        addCallToHistory(state.targetId, 'incoming', false);
        
        showNotification('Call Connected', 'Speaking with ' + state.targetId);
        
    } catch (err) {
        console.error('Failed to handle offer:', err);
        showNotification('Call Error', err.message);
        cleanupCall();
    }
}

// ==================== PEER CONNECTION ====================
async function createPeerConnectionWithRetry() {
    for (var i = 0; i < CONFIG.maxRetries; i++) {
        try {
            var pc = createPeerConnection();
            if (pc) return pc;
        } catch (err) {
            console.warn('PC creation attempt', i + 1, 'failed:', err);
            if (i < CONFIG.maxRetries - 1) {
                await delay(CONFIG.retryDelay);
            }
        }
    }
    return null;
}

function createPeerConnection() {
    var pc = new RTCPeerConnection({
        iceServers: CONFIG.iceServers,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    });
    
    // ICE handling
    pc.onicecandidate = function(e) {
        if (e.candidate && state.targetId) {
            state.socket.emit('signal', {
                to: state.targetId,
                from: state.myId,
                type: 'ice-candidate',
                candidate: e.candidate
            });
        }
    };
    
    // Connection state changes
    pc.onconnectionstatechange = function() {
        console.log('Connection state:', pc.connectionState);
        
        switch (pc.connectionState) {
            case 'connected':
                state.inCall = true;
                state.reconnectAttempts = 0;
                showNotification('✅ Connected', 'Call established');
                break;
            case 'disconnected':
                handleDisconnect();
                break;
            case 'failed':
                handleConnectionFailed();
                break;
            case 'closed':
                cleanupCall();
                break;
        }
    };
    
    // ICE state
    pc.oniceconnectionstatechange = function() {
        console.log('ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
            pc.restartIce();
        }
    };
    
    // Remote stream
    pc.ontrack = function(e) {
        console.log('📹 Remote stream received');
        state.remoteStream = e.streams[0];
        updateRemoteVideo();
    };
    
    return pc;
}

async function handleAnswer(data) {
    try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('✅ Answer received, call established');
        state.inCall = true;
    } catch (err) {
        console.error('Failed to set answer:', err);
    }
}

async function handleIceCandidate(data) {
    try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('ICE candidate error:', err);
    }
}

// ==================== VIDEO HANDLING ====================
window.toggleVideo = async function(e) {
    if (e) e.stopPropagation();
    
    var videoBtn = document.getElementById('videoBtn');
    
    if (!state.videoEnabled) {
        // Enable video
        try {
            await startVideoPreview();
            state.videoEnabled = true;
            if (videoBtn) videoBtn.classList.add('active');
            
            // If in call, notify remote
            if (state.inCall && state.socket) {
                state.socket.emit('signal', {
                    to: state.targetId,
                    from: state.myId,
                    type: 'video-toggle',
                    enabled: true
                });
            }
            
        } catch (err) {
            console.error('Failed to start video:', err);
            alert('❌ Camera error: ' + err.message);
        }
    } else {
        // Disable video
        stopVideoPreview();
        state.videoEnabled = false;
        if (videoBtn) videoBtn.classList.remove('active');
        
        if (state.inCall && state.socket) {
            state.socket.emit('signal', {
                to: state.targetId,
                from: state.myId,
                type: 'video-toggle',
                enabled: false
            });
        }
    }
};

async function startVideoPreview() {
    var localVideo = document.getElementById('localVideo');
    var videoContainer = document.getElementById('videoContainer');
    
    try {
        var stream = await navigator.mediaDevices.getUserMedia({
            video: getVideoConstraints(),
            audio: false
        });
        
        if (localVideo) {
            localVideo.srcObject = stream;
            localVideo.style.display = 'block';
            localVideo.muted = true;
            localVideo.play().catch(function() {});
        }
        
        if (videoContainer) {
            videoContainer.style.display = 'block';
        }
        
        return stream;
    } catch (err) {
        console.error('Video preview failed:', err);
        throw err;
    }
}

function stopVideoPreview() {
    var localVideo = document.getElementById('localVideo');
    var videoContainer = document.getElementById('videoContainer');
    
    if (localVideo?.srcObject) {
        localVideo.srcObject.getTracks().forEach(function(track) { track.stop(); });
        localVideo.srcObject = null;
    }
    
    if (!state.inCall) {
        if (videoContainer) videoContainer.style.display = 'none';
        if (localVideo) localVideo.style.display = 'none';
    }
}

function updateLocalVideo() {
    var localVideo = document.getElementById('localVideo');
    var videoContainer = document.getElementById('videoContainer');
    
    if (state.localStream && state.videoEnabled) {
        if (localVideo) {
            localVideo.srcObject = state.localStream;
            localVideo.style.display = 'block';
            localVideo.play().catch(function() {});
        }
        if (videoContainer) {
            videoContainer.style.display = 'block';
        }
    }
}

function updateRemoteVideo() {
    var remoteVideo = document.getElementById('remoteVideo');
    var videoContainer = document.getElementById('videoContainer');
    
    if (state.remoteStream) {
        if (remoteVideo) {
            remoteVideo.srcObject = state.remoteStream;
            remoteVideo.style.display = 'block';
            remoteVideo.play().catch(function() {});
        }
        if (videoContainer) {
            videoContainer.style.display = 'block';
        }
    }
}

function handleRemoteVideoToggle(enabled) {
    var remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo) {
        remoteVideo.style.display = enabled ? 'block' : 'none';
    }
    showNotification('Video', 'Remote video ' + (enabled ? 'on' : 'off'));
}

// ==================== DEVICE SELECTION ====================
async function enumerateDevices() {
    try {
        // Request permissions first
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        
        var devices = await navigator.mediaDevices.enumerateDevices();
        
        var micSelect = document.getElementById('micSelect');
        var cameraSelect = document.getElementById('cameraSelect');
        var audioOutputSelect = document.getElementById('audioOutputSelect');
        
        if (micSelect) {
            micSelect.innerHTML = '<option value="">Default Microphone</option>';
            devices.filter(function(d) { return d.kind === 'audioinput'; }).forEach(function(device) {
                var option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || 'Microphone ' + device.deviceId.slice(0, 8);
                micSelect.appendChild(option);
            });
        }
        
        if (cameraSelect) {
            cameraSelect.innerHTML = '<option value="">Default Camera</option>';
            devices.filter(function(d) { return d.kind === 'videoinput'; }).forEach(function(device) {
                var option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || 'Camera ' + device.deviceId.slice(0, 8);
                cameraSelect.appendChild(option);
            });
        }
        
        if (audioOutputSelect) {
            audioOutputSelect.innerHTML = '<option value="">Default Output</option>';
            devices.filter(function(d) { return d.kind === 'audiooutput'; }).forEach(function(device) {
                var option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || 'Output ' + device.deviceId.slice(0, 8);
                audioOutputSelect.appendChild(option);
            });
        }
        
        console.log('📱 Devices enumerated:', devices.length);
        
    } catch (err) {
        console.error('Device enumeration failed:', err);
    }
}

window.refreshDevices = function() {
    enumerateDevices();
    showNotification('Devices', 'Device list refreshed');
};

async function testDevicesBeforeCall() {
    var results = { audio: false, video: false };
    
    try {
        var audioTest = await navigator.mediaDevices.getUserMedia({ 
            audio: getAudioConstraints(), 
            video: false 
        });
        audioTest.getTracks().forEach(function(t) { t.stop(); });
        results.audio = true;
    } catch (err) {
        console.warn('Audio test failed:', err);
    }
    
    if (state.videoEnabled) {
        try {
            var videoTest = await navigator.mediaDevices.getUserMedia({ 
                audio: false, 
                video: getVideoConstraints() 
            });
            videoTest.getTracks().forEach(function(t) { t.stop(); });
            results.video = true;
        } catch (err) {
            console.warn('Video test failed:', err);
        }
    }
    
    return results;
}

function getAudioConstraints() {
    return {
        echoCancellation: deviceSettings.echoCancellation,
        noiseSuppression: deviceSettings.noiseSuppression,
        autoGainControl: deviceSettings.autoGainControl,
        sampleRate: 48000,
        channelCount: 1,
        deviceId: deviceSettings.microphone ? { exact: deviceSettings.microphone } : undefined
    };
}

function getVideoConstraints() {
    var quality = deviceSettings.videoQuality.split('x');
    return {
        width: { ideal: parseInt(quality[0]) },
        height: { ideal: parseInt(quality[1]) },
        frameRate: { ideal: deviceSettings.frameRate },
        facingMode: 'user',
        deviceId: deviceSettings.camera ? { exact: deviceSettings.camera } : undefined
    };
}

function applyAudioOutput(deviceId) {
    var audioElements = document.querySelectorAll('audio');
    audioElements.forEach(function(audio) {
        if (audio.setSinkId) {
            audio.setSinkId(deviceId).catch(function(err) {
                console.error('setSinkId failed:', err);
            });
        }
    });
}

// ==================== END CALL ====================
async function endCall() {
    console.log('📞 Ending call...');
    
    // Notify remote
    if (state.socket && state.targetId) {
        state.socket.emit('signal', {
            to: state.targetId,
            from: state.myId,
            type: 'hangup'
        });
    }
    
    cleanupCall();
    showNotification('Call Ended', 'Call duration: ' + getCallDuration());
}

function cleanupCall() {
    state.inCall = false;
    state.isInitiator = false;
    state.callStartTime = null;
    
    // Stop stats
    if (state.statsInterval) {
        clearInterval(state.statsInterval);
        state.statsInterval = null;
    }
    
    // Close peer connection
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    
    // Stop streams
    if (state.localStream) {
        state.localStream.getTracks().forEach(function(track) { track.stop(); });
        state.localStream = null;
    }
    
    if (state.remoteStream) {
        state.remoteStream.getTracks().forEach(function(track) { track.stop(); });
        state.remoteStream = null;
    }
    
    // Hide video
    var localVideo = document.getElementById('localVideo');
    var remoteVideo = document.getElementById('remoteVideo');
    var videoContainer = document.getElementById('videoContainer');
    
    if (localVideo) { localVideo.srcObject = null; localVideo.style.display = 'none'; }
    if (remoteVideo) { remoteVideo.srcObject = null; remoteVideo.style.display = 'none'; }
    if (videoContainer && !state.videoEnabled) videoContainer.style.display = 'none';
    
    setCallUI(false);
}

function handleRemoteHangup() {
    showNotification('Call Ended', 'Remote user hung up');
    cleanupCall();
}

function handleDisconnect() {
    if (state.inCall && state.reconnectAttempts < CONFIG.maxRetries) {
        state.reconnectAttempts++;
        console.log('Attempting reconnect...', state.reconnectAttempts);
        setTimeout(function() {
            if (state.isInitiator) {
                startCall();
            }
        }, CONFIG.retryDelay);
    }
}

function handleConnectionFailed() {
    console.error('Connection failed');
    showNotification('Connection Failed', 'Could not establish connection');
    cleanupCall();
}

// ==================== UI UPDATES ====================
function setCallUI(inCall) {
    var callBtn = document.getElementById('callBtn');
    var callLbl = document.getElementById('callLbl');
    var statsPanel = document.getElementById('connectionStats');
    
    if (callBtn) {
        callBtn.classList.toggle('in-call', inCall);
    }
    if (callLbl) {
        callLbl.textContent = inCall ? 'Hang Up' : 'Call';
    }
    if (statsPanel) {
        statsPanel.style.display = inCall ? 'flex' : 'none';
    }
}

function getCallDuration() {
    if (!state.callStartTime) return '0:00';
    var diff = Math.floor((Date.now() - state.callStartTime) / 1000);
    var mins = Math.floor(diff / 60);
    var secs = diff % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

// ==================== STATS ====================
function startStatsUpdate() {
    if (state.statsInterval) clearInterval(state.statsInterval);
    
    state.statsInterval = setInterval(async function() {
        if (!state.peerConnection || !state.inCall) return;
        
        try {
            var stats = await state.peerConnection.getStats();
            var statsData = { ping: '--', bitrate: '--', loss: '0', codec: 'Opus' };
            
            stats.forEach(function(report) {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    if (report.currentRoundTripTime) {
                        statsData.ping = Math.round(report.currentRoundTripTime * 1000);
                    }
                }
                
                if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                    if (report.targetBitrate) {
                        statsData.bitrate = Math.round(report.targetBitrate / 1000);
                    }
                    if (report.packetsLost !== undefined && report.packetsSent) {
                        var total = report.packetsSent + report.packetsLost;
                        statsData.loss = ((report.packetsLost / total) * 100).toFixed(1);
                    }
                    if (report.codecId) {
                        var codec = stats.get(report.codecId);
                        if (codec) statsData.codec = codec.mimeType?.split('/')[1] || 'Opus';
                    }
                }
            });
            
            updateStatsDisplay(statsData);
            
        } catch (err) {
            console.error('Stats error:', err);
        }
    }, 2000);
}

function updateStatsDisplay(data) {
    var pingEl = document.getElementById('statPing');
    var bitrateEl = document.getElementById('statBitrate');
    var lossEl = document.getElementById('statLoss');
    var codecEl = document.getElementById('statCodec');
    
    if (pingEl) pingEl.textContent = data.ping + 'ms';
    if (bitrateEl) bitrateEl.textContent = data.bitrate + 'kbps';
    if (lossEl) lossEl.textContent = data.loss + '%';
    if (codecEl) codecEl.textContent = data.codec;
}

// ==================== CHAT ====================
window.sendChatMessage = function() {
    var input = document.getElementById('chatInput');
    var messages = document.getElementById('chatMessages');
    var chatSection = document.getElementById('chatSection');
    
    if (!input || !messages) return;
    
    var text = input.value.trim();
    if (!text) return;
    
    // Show chat
    if (chatSection) chatSection.style.display = 'block';
    
    // Add message
    var msg = document.createElement('div');
    msg.className = 'nvx-chat-message';
    msg.innerHTML = '<strong>You:</strong> ' + escapeHtml(text);
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    
    // Send
    if (state.socket && state.targetId) {
        state.socket.emit('signal', {
            to: state.targetId,
            from: state.myId,
            type: 'chat',
            text: text
        });
    }
    
    input.value = '';
};

function handleChatMessage(data) {
    var messages = document.getElementById('chatMessages');
    var chatSection = document.getElementById('chatSection');
    
    if (chatSection) chatSection.style.display = 'block';
    
    if (messages) {
        var msg = document.createElement('div');
        msg.className = 'nvx-chat-message remote';
        msg.innerHTML = '<strong>' + escapeHtml(data.from) + ':</strong> ' + escapeHtml(data.text);
        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;
    }
}

// ==================== CONTACTS ====================
var contacts = [];

function loadContacts() {
    var saved = localStorage.getItem('nevax_contacts');
    if (saved) {
        contacts = JSON.parse(saved);
        renderContacts();
    }
}

function saveContacts() {
    localStorage.setItem('nevax_contacts', JSON.stringify(contacts));
}

function renderContacts() {
    var list = document.getElementById('contactsList');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (contacts.length === 0) {
        list.innerHTML = '<div class="nvx-contact-item"><span class="nvx-contact-name">No contacts. Click + to add.</span></div>';
        return;
    }
    
    contacts.forEach(function(contact) {
        var item = document.createElement('div');
        item.className = 'nvx-contact-item';
        item.setAttribute('data-id', contact.id);
        item.innerHTML = 
            '<div class="nvx-contact-status ' + (contact.online ? 'online' : 'offline') + '"></div>' +
            '<span class="nvx-contact-name">' + escapeHtml(contact.name) + '</span>' +
            '<span class="nvx-contact-id">#' + contact.id + '</span>' +
            '<button class="nvx-contact-call" onclick="callContact(\'' + contact.id + '\')">' +
            '<i class="fa-solid fa-phone"></i></button>';
        list.appendChild(item);
    });
}

window.addContact = function() {
    var friendInput = document.getElementById('friendIdInput');
    var friendId = friendInput?.value?.trim();
    
    if (!friendId) {
        alert('Enter Friend ID first!');
        return;
    }
    
    var name = prompt('Contact name:', 'Friend');
    if (!name) return;
    
    if (contacts.find(function(c) { return c.id === friendId; })) {
        alert('Contact already exists!');
        return;
    }
    
    contacts.push({ id: friendId, name: name, online: false });
    saveContacts();
    renderContacts();
    
    showNotification('Contact Added', name + ' #' + friendId);
};

window.callContact = function(contactId) {
    var friendInput = document.getElementById('friendIdInput');
    if (friendInput) friendInput.value = contactId;
    state.targetId = contactId;
    
    if (!state.socket) initConnection();
    startCallWithChecks();
};

function updateContactStatus(id, status) {
    var contact = contacts.find(function(c) { return c.id === id; });
    if (contact) {
        contact.online = status === 'online';
        renderContacts();
    }
}

// ==================== CALL HISTORY ====================
var callHistory = [];

function loadCallHistory() {
    var saved = localStorage.getItem('nevax_call_history');
    if (saved) {
        callHistory = JSON.parse(saved);
        renderCallHistory();
    }
}

function saveCallHistory() {
    localStorage.setItem('nevax_call_history', JSON.stringify(callHistory.slice(-50)));
}

function renderCallHistory() {
    var list = document.getElementById('historyList');
    if (!list) return;
    
    if (callHistory.length === 0) {
        list.innerHTML = '<div class="nvx-history-empty">No calls yet</div>';
        return;
    }
    
    list.innerHTML = '';
    callHistory.slice(-10).reverse().forEach(function(call) {
        var item = document.createElement('div');
        item.className = 'nvx-history-item ' + call.type + (call.missed ? ' missed' : '');
        
        var date = new Date(call.time);
        var timeStr = date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
        
        item.innerHTML = 
            '<span>' + escapeHtml(call.contactName) + ' #' + call.contactId + '</span>' +
            '<span>' + timeStr + '</span>';
        list.appendChild(item);
    });
}

function addCallToHistory(contactId, type, missed) {
    var contact = contacts.find(function(c) { return c.id === contactId; });
    var contactName = contact ? contact.name : 'Unknown';
    
    callHistory.push({
        contactId: contactId,
        contactName: contactName,
        type: type,
        missed: missed,
        time: Date.now()
    });
    
    saveCallHistory();
    renderCallHistory();
}

// ==================== SETTINGS ====================
function loadSettings() {
    var saved = localStorage.getItem('nevax_settings');
    if (saved) {
        deviceSettings = JSON.parse(saved);
        applySettingsToUI();
    }
    
    // Load devices
    var savedDevices = localStorage.getItem('nevax_devices');
    if (savedDevices) {
        var devices = JSON.parse(savedDevices);
        deviceSettings.microphone = devices.microphone || '';
        deviceSettings.camera = devices.camera || '';
        deviceSettings.audioOutput = devices.audioOutput || '';
    }
}

function applySettingsToUI() {
    var echoCheck = document.getElementById('settingEcho');
    var noiseCheck = document.getElementById('settingNoise');
    var agcCheck = document.getElementById('settingAGC');
    var autoAnswerCheck = document.getElementById('settingAutoAnswer');
    var videoPreviewCheck = document.getElementById('settingVideoPreview');
    var ringVolume = document.getElementById('ringVolume');
    var ringVolumeValue = document.getElementById('ringVolumeValue');
    
    if (echoCheck) echoCheck.checked = deviceSettings.echoCancellation;
    if (noiseCheck) noiseCheck.checked = deviceSettings.noiseSuppression;
    if (agcCheck) agcCheck.checked = deviceSettings.autoGainControl;
    if (autoAnswerCheck) autoAnswerCheck.checked = deviceSettings.autoAnswer || false;
    if (videoPreviewCheck) videoPreviewCheck.checked = deviceSettings.videoPreview || false;
    if (ringVolume) ringVolume.value = deviceSettings.ringVolume || 80;
    if (ringVolumeValue) ringVolumeValue.textContent = (deviceSettings.ringVolume || 80) + '%';
}

window.saveAllSettings = function() {
    // Get values from UI
    var echoCheck = document.getElementById('settingEcho');
    var noiseCheck = document.getElementById('settingNoise');
    var agcCheck = document.getElementById('settingAGC');
    var autoAnswerCheck = document.getElementById('settingAutoAnswer');
    var videoPreviewCheck = document.getElementById('settingVideoPreview');
    var micSelect = document.getElementById('micSelect');
    var cameraSelect = document.getElementById('cameraSelect');
    var audioOutputSelect = document.getElementById('audioOutputSelect');
    var ringVolume = document.getElementById('ringVolume');
    
    deviceSettings.echoCancellation = echoCheck?.checked ?? true;
    deviceSettings.noiseSuppression = noiseCheck?.checked ?? true;
    deviceSettings.autoGainControl = agcCheck?.checked ?? true;
    deviceSettings.autoAnswer = autoAnswerCheck?.checked ?? false;
    deviceSettings.videoPreview = videoPreviewCheck?.checked ?? false;
    deviceSettings.microphone = micSelect?.value || '';
    deviceSettings.camera = cameraSelect?.value || '';
    deviceSettings.audioOutput = audioOutputSelect?.value || '';
    deviceSettings.ringVolume = ringVolume?.value || 80;
    
    // Save
    localStorage.setItem('nevax_settings', JSON.stringify(deviceSettings));
    localStorage.setItem('nevax_devices', JSON.stringify({
        microphone: deviceSettings.microphone,
        camera: deviceSettings.camera,
        audioOutput: deviceSettings.audioOutput
    }));
    
    showNotification('Settings Saved', 'All preferences saved');
};

window.toggleSettings = function() {
    var panel = document.getElementById('settingsPanel');
    if (panel) {
        var isHidden = panel.style.display === 'none';
        panel.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            enumerateDevices();
            loadSettings();
        }
    }
};

// ==================== TEST FUNCTIONS ====================
window.testMicrophone = async function() {
    var btn = document.querySelector('#micSelect + .nvx-setting-test') || 
              document.querySelector('button[onclick="testMicrophone()"]');
    
    if (btn?.classList.contains('testing')) {
        // Stop test
        if (window._testMicStream) {
            window._testMicStream.getTracks().forEach(function(t) { t.stop(); });
            window._testMicStream = null;
        }
        if (window._testMicInterval) {
            clearInterval(window._testMicInterval);
            window._testMicInterval = null;
        }
        btn.classList.remove('testing');
        btn.innerHTML = '<i class="fa-solid fa-microphone-lines"></i> Test';
        return;
    }
    
    try {
        var stream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: false
        });
        window._testMicStream = stream;
        
        // Visual feedback
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        var audioCtx = new AudioContext();
        var analyser = audioCtx.createAnalyser();
        var source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        
        var dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        window._testMicInterval = setInterval(function() {
            analyser.getByteFrequencyData(dataArray);
            var average = dataArray.reduce(function(a, b) { return a + b; }) / dataArray.length;
            if (btn) {
                btn.style.opacity = 0.3 + (average / 255) * 0.7;
            }
        }, 50);
        
        btn?.classList.add('testing');
        btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
        
        showNotification('Microphone Test', 'Speak to see activity');
        
    } catch (err) {
        alert('❌ Microphone test failed: ' + err.message);
    }
};

window.testCamera = async function() {
    var btn = document.querySelector('#cameraSelect + .nvx-setting-test') ||
              document.querySelector('button[onclick="testCamera()"]');
    
    if (state.videoEnabled) {
        await window.toggleVideo();
        btn?.classList.remove('testing');
        btn.innerHTML = '<i class="fa-solid fa-video"></i> Test';
        return;
    }
    
    try {
        await window.toggleVideo();
        btn?.classList.add('testing');
        btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
        showNotification('Camera Test', 'Camera preview active');
    } catch (err) {
        alert('❌ Camera test failed: ' + err.message);
    }
};

// ==================== UTILITIES ====================
function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(title, body) {
    console.log('[' + title + ']', body);
    
    // Custom notification element
    var notif = document.getElementById('nvx-notification');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'nvx-notification';
        notif.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#00ff00;color:#000;padding:10px 20px;border-radius:0;z-index:1000;font-size:12px;box-shadow:0 0 20px #00ff00;';
        document.body.appendChild(notif);
    }
    
    notif.innerHTML = '<strong>' + title + '</strong><br>' + body;
    notif.style.display = 'block';
    
    setTimeout(function() {
        notif.style.display = 'none';
    }, 3000);
}

function setupEventListeners() {
    // Chat input
    var chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') window.sendChatMessage();
        });
    }
    
    // Ring volume
    var ringVolume = document.getElementById('ringVolume');
    var ringVolumeValue = document.getElementById('ringVolumeValue');
    if (ringVolume && ringVolumeValue) {
        ringVolume.addEventListener('input', function() {
            ringVolumeValue.textContent = this.value + '%';
        });
    }
    
    // Device selects
    var micSelect = document.getElementById('micSelect');
    var cameraSelect = document.getElementById('cameraSelect');
    var audioOutputSelect = document.getElementById('audioOutputSelect');
    
    if (micSelect) {
        micSelect.addEventListener('change', function() {
            deviceSettings.microphone = this.value;
        });
    }
    if (cameraSelect) {
        cameraSelect.addEventListener('change', function() {
            deviceSettings.camera = this.value;
        });
    }
    if (audioOutputSelect) {
        audioOutputSelect.addEventListener('change', function() {
            deviceSettings.audioOutput = this.value;
            applyAudioOutput(this.value);
        });
    }
}

function waitForIceGathering() {
    return new Promise(function(resolve) {
        if (!state.peerConnection || state.peerConnection.iceGatheringState === 'complete') {
            resolve();
            return;
        }
        
        var checkState = function() {
            if (state.peerConnection.iceGatheringState === 'complete') {
                state.peerConnection.removeEventListener('icegatheringstatechange', checkState);
                resolve();
            }
        };
        
        state.peerConnection.addEventListener('icegatheringstatechange', checkState);
        setTimeout(resolve, 3000); // Timeout fallback
    });
}

// Handle mute
window.handleMute = function(e) {
    if (e) e.stopPropagation();
    
    if (!state.localStream) return;
    
    var audioTracks = state.localStream.getAudioTracks();
    var isMuted = false;
    
    audioTracks.forEach(function(track) {
        track.enabled = !track.enabled;
        isMuted = !track.enabled;
    });
    
    var muteBtn = document.getElementById('muteBtn');
    var muteLbl = document.getElementById('muteLbl');
    
    if (muteBtn) muteBtn.classList.toggle('active', isMuted);
    if (muteLbl) muteLbl.textContent = isMuted ? 'Unmute' : 'Mute';
    
    showNotification(isMuted ? 'Muted' : 'Unmuted', 'Microphone ' + (isMuted ? 'off' : 'on'));
};

console.log('✅ Nevax WebRTC loaded successfully');
