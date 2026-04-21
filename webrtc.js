// ==================== WEBRTC CONNECTION ====================
var peerConnection = null;
var localStream = null;
var remoteStream = null;
var socket = null;
var myId = null;
var targetId = null;
var isInitiator = false;
var inCall = false;

// ICE servers - STUN + TURN for 100% connectivity
const iceServers = {
    iceServers: [
        // Public STUN servers
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Free TURN servers (for NAT traversal)
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all'
};

function initConnection() {
    var myIdInput = document.querySelector('input[value="user_42"]');
    myId = myIdInput ? myIdInput.value : 'user_' + Math.floor(Math.random() * 1000);
    if (myIdInput) myIdInput.value = myId;

    // Connect to signaling server
    socket = io('http://localhost:3000', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });

    socket.on('connect', function() {
        console.log('Connected to signaling server');
        socket.emit('register', myId);
    });

    socket.on('connect_error', function(err) {
        console.error('Socket connection error:', err.message);
    });

    socket.on('signal', handleSignal);
    
    socket.on('user-connected', function(id) {
        console.log('User connected:', id);
    });
    
    socket.on('user-disconnected', function(id) {
        console.log('User disconnected:', id);
        if (targetId === id) {
            closeConnection();
        }
    });

    // Auto-connect when friend_id changes
    var friendInput = document.querySelector('input[value="2"]');
    if (friendInput) {
        friendInput.addEventListener('change', function() {
            targetId = this.value;
        });
    }
}

async function startCall() {
    var friendInput = document.querySelector('input[value="2"]');
    targetId = friendInput ? friendInput.value : targetId;
    if (!targetId) {
        alert('Enter friend ID first!');
        return;
    }

    isInitiator = true;
    await createPeerConnection();

    // Get local audio
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 48000,
                channelCount: 1
            },
            video: false
        });
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        console.log('Local stream added');
    } catch (err) {
        console.error('Failed to get mic:', err);
        alert('Microphone access denied!');
        return;
    }

    // Create offer
    try {
        var offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        await peerConnection.setLocalDescription(offer);
        console.log('Offer created');

        // Wait for ICE gathering
        await waitForIceGathering();

        // Send offer
        socket.emit('signal', {
            to: targetId,
            from: myId,
            type: 'offer',
            sdp: peerConnection.localDescription
        });
    } catch (err) {
        console.error('Offer failed:', err);
    }
}

async function handleSignal(data) {
    console.log('Signal received:', data.type, 'from:', data.from);

    if (data.type === 'offer') {
        targetId = data.from;
        isInitiator = false;

        await createPeerConnection();

        // Get local audio
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000,
                    channelCount: 1
                },
                video: false
            });
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        } catch (err) {
            console.error('Failed to get mic:', err);
            return;
        }

        // Set remote description (offer)
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));

        // Create answer
        var answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Wait for ICE
        await waitForIceGathering();

        // Send answer
        socket.emit('signal', {
            to: targetId,
            from: myId,
            type: 'answer',
            sdp: peerConnection.localDescription
        });

    } else if (data.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('Answer received, connected!');

    } else if (data.type === 'ice-candidate') {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('ICE candidate error:', err);
        }
    } else if (data.type === 'hangup') {
        closeConnection();
    }
}

async function createPeerConnection() {
    if (peerConnection) {
        peerConnection.close();
    }

    peerConnection = new RTCPeerConnection(iceServers);

    peerConnection.onicecandidate = function(event) {
        if (event.candidate && targetId) {
            socket.emit('signal', {
                to: targetId,
                from: myId,
                type: 'ice-candidate',
                candidate: event.candidate
            });
        }
    };

    peerConnection.onconnectionstatechange = function() {
        console.log('Connection state:', peerConnection.connectionState);
        var callBtn = document.getElementById('callBtn');
        if (peerConnection.connectionState === 'connected') {
            console.log('PEER CONNECTED!');
            if (callBtn) callBtn.classList.add('in-call');
            inCall = true;
        } else if (peerConnection.connectionState === 'disconnected' ||
                   peerConnection.connectionState === 'failed') {
            console.log('Connection lost');
            if (callBtn) callBtn.classList.remove('in-call');
            inCall = false;
            // Try to reconnect
            setTimeout(function() {
                if (isInitiator && targetId) {
                    console.log('Attempting reconnection...');
                    startCall();
                }
            }, 2000);
        }
    };

    peerConnection.ontrack = function(event) {
        console.log('Remote stream received!');
        remoteStream = event.streams[0];
        // Play remote audio
        var audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audio.play().catch(e => console.error('Audio play failed:', e));
    };

    // ICE restart on failure
    peerConnection.oniceconnectionstatechange = function() {
        console.log('ICE state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
            console.log('ICE failed, restarting...');
            peerConnection.restartIce();
        }
    };

    return peerConnection;
}

function waitForIceGathering() {
    return new Promise(function(resolve) {
        if (peerConnection.iceGatheringState === 'complete') {
            resolve();
        } else {
            var checkState = function() {
                if (peerConnection.iceGatheringState === 'complete') {
                    peerConnection.removeEventListener('icegatheringstatechange', checkState);
                    resolve();
                }
            };
            peerConnection.addEventListener('icegatheringstatechange', checkState);
            // Timeout fallback
            setTimeout(resolve, 2000);
        }
    });
}

function closeConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(function(track) { track.stop(); });
        localStream = null;
    }
    inCall = false;
    var callBtn = document.getElementById('callBtn');
    if (callBtn) callBtn.classList.remove('in-call');
}

// Override global handleCall function
window.handleCall = function(e) {
    if (e) e.stopPropagation();

    if (inCall) {
        // Hang up
        closeConnection();
        if (socket && targetId) {
            socket.emit('signal', { to: targetId, from: myId, type: 'hangup' });
        }
    } else {
        // Start call
        if (!socket) initConnection();
        startCall();
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    initConnection();
    loadSettings();
    loadContacts();
    loadCallHistory();
    enumerateDevices();
    
    // Ring volume slider
    var ringVolumeSlider = document.getElementById('ringVolume');
    var ringVolumeValue = document.getElementById('ringVolumeValue');
    if (ringVolumeSlider && ringVolumeValue) {
        ringVolumeSlider.addEventListener('input', function() {
            ringVolumeValue.textContent = this.value + '%';
        });
    }
});

// ==================== DEVICE SELECTION ====================
var selectedDevices = {
    microphone: '',
    camera: '',
    audioOutput: ''
};

async function enumerateDevices() {
    try {
        // Request permission first
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        
        var devices = await navigator.mediaDevices.enumerateDevices();
        
        var micSelect = document.getElementById('micSelect');
        var cameraSelect = document.getElementById('cameraSelect');
        var audioOutputSelect = document.getElementById('audioOutputSelect');
        
        // Clear existing options (keep default)
        if (micSelect) micSelect.innerHTML = '<option value="">Default Microphone</option>';
        if (cameraSelect) cameraSelect.innerHTML = '<option value="">Default Camera</option>';
        if (audioOutputSelect) audioOutputSelect.innerHTML = '<option value="">Default Output</option>';
        
        devices.forEach(function(device) {
            var option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || (device.kind === 'audioinput' ? 'Microphone ' : 
                                           device.kind === 'videoinput' ? 'Camera ' : 'Output ') + 
                          device.deviceId.slice(0, 8);
            
            if (device.kind === 'audioinput' && micSelect) {
                micSelect.appendChild(option);
            } else if (device.kind === 'videoinput' && cameraSelect) {
                cameraSelect.appendChild(option);
            } else if (device.kind === 'audiooutput' && audioOutputSelect) {
                audioOutputSelect.appendChild(option);
            }
        });
        
        console.log('Devices enumerated:', devices.length);
    } catch (err) {
        console.error('Failed to enumerate devices:', err);
    }
}

window.refreshDevices = function() {
    enumerateDevices();
    
    // Visual feedback
    var btn = document.querySelector('.nvx-settings-btn.refresh');
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Refreshed';
        setTimeout(function() {
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh Devices';
        }, 1500);
    }
};

// Handle device selection changes
document.addEventListener('DOMContentLoaded', function() {
    var micSelect = document.getElementById('micSelect');
    var cameraSelect = document.getElementById('cameraSelect');
    var audioOutputSelect = document.getElementById('audioOutputSelect');
    
    if (micSelect) {
        micSelect.addEventListener('change', function() {
            selectedDevices.microphone = this.value;
            console.log('Selected microphone:', this.value);
        });
    }
    
    if (cameraSelect) {
        cameraSelect.addEventListener('change', function() {
            selectedDevices.camera = this.value;
            console.log('Selected camera:', this.value);
        });
    }
    
    if (audioOutputSelect) {
        audioOutputSelect.addEventListener('change', function() {
            selectedDevices.audioOutput = this.value;
            console.log('Selected audio output:', this.value);
            
            // Apply to existing audio elements
            var audioElements = document.querySelectorAll('audio');
            audioElements.forEach(function(audio) {
                if (audio.setSinkId) {
                    audio.setSinkId(selectedDevices.audioOutput).catch(function(err) {
                        console.error('Failed to set audio output:', err);
                    });
                }
            });
        });
    }
});

// Get constraints with selected devices
function getAudioConstraints() {
    var constraints = {
        echoCancellation: document.getElementById('settingEcho')?.checked ?? true,
        noiseSuppression: document.getElementById('settingNoise')?.checked ?? true,
        autoGainControl: document.getElementById('settingAGC')?.checked ?? true,
        sampleRate: 48000,
        channelCount: 1
    };
    
    if (selectedDevices.microphone) {
        constraints.deviceId = { exact: selectedDevices.microphone };
    }
    
    return constraints;
}

function getVideoConstraints() {
    var constraints = {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
    };
    
    if (selectedDevices.camera) {
        constraints.deviceId = { exact: selectedDevices.camera };
    }
    
    return constraints;
}

// Test microphone
var testMicStream = null;
var testMicInterval = null;

window.testMicrophone = async function() {
    var btn = document.querySelector('#micSelect + .nvx-setting-test');
    
    if (testMicStream) {
        // Stop testing
        testMicStream.getTracks().forEach(function(track) { track.stop(); });
        testMicStream = null;
        clearInterval(testMicInterval);
        if (btn) {
            btn.classList.remove('testing');
            btn.innerHTML = '<i class="fa-solid fa-microphone-lines"></i> Test';
        }
        return;
    }
    
    try {
        testMicStream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: false
        });
        
        // Create audio context for visualization
        var audioContext = new (window.AudioContext || window.webkitAudioContext)();
        var analyser = audioContext.createAnalyser();
        var microphone = audioContext.createMediaStreamSource(testMicStream);
        microphone.connect(analyser);
        analyser.fftSize = 256;
        
        var dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        testMicInterval = setInterval(function() {
            analyser.getByteFrequencyData(dataArray);
            var average = dataArray.reduce(function(a, b) { return a + b; }) / dataArray.length;
            
            // Visual feedback based on volume
            if (btn) {
                btn.style.opacity = 0.5 + (average / 255) * 0.5;
            }
        }, 50);
        
        if (btn) {
            btn.classList.add('testing');
            btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
        }
        
        console.log('Microphone test started');
    } catch (err) {
        console.error('Failed to test microphone:', err);
        alert('Failed to test microphone: ' + err.message);
    }
};

// Test camera
var testCameraStream = null;

window.testCamera = async function() {
    var btn = document.querySelector('#cameraSelect + .nvx-setting-test');
    var videoContainer = document.getElementById('videoContainer');
    var localVideo = document.getElementById('localVideo');
    
    if (testCameraStream) {
        // Stop testing
        testCameraStream.getTracks().forEach(function(track) { track.stop(); });
        testCameraStream = null;
        
        if (localVideo) localVideo.srcObject = null;
        if (videoContainer) videoContainer.style.display = 'none';
        
        if (btn) {
            btn.classList.remove('testing');
            btn.innerHTML = '<i class="fa-solid fa-video"></i> Test';
        }
        return;
    }
    
    try {
        testCameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: getVideoConstraints()
        });
        
        if (localVideo) {
            localVideo.srcObject = testCameraStream;
            localVideo.style.display = 'block';
        }
        if (videoContainer) {
            videoContainer.style.display = 'block';
            var remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo) remoteVideo.style.display = 'none';
        }
        
        if (btn) {
            btn.classList.add('testing');
            btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
        }
        
        console.log('Camera test started');
    } catch (err) {
        console.error('Failed to test camera:', err);
        alert('Failed to test camera: ' + err.message);
    }
};

window.saveAllSettings = function() {
    // Save device selections
    selectedDevices.microphone = document.getElementById('micSelect')?.value || '';
    selectedDevices.camera = document.getElementById('cameraSelect')?.value || '';
    selectedDevices.audioOutput = document.getElementById('audioOutputSelect')?.value || '';
    
    // Save to localStorage
    localStorage.setItem('nevax_devices', JSON.stringify(selectedDevices));
    
    // Save ring volume
    var ringVolume = document.getElementById('ringVolume')?.value || 80;
    localStorage.setItem('nevax_ring_volume', ringVolume);
    
    // Visual feedback
    var btn = document.querySelector('.nvx-settings-btn.save');
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
        setTimeout(function() {
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
        }, 1500);
    }
    
    console.log('Settings saved:', selectedDevices);
};

// Load saved devices
function loadDevices() {
    var saved = localStorage.getItem('nevax_devices');
    if (saved) {
        selectedDevices = JSON.parse(saved);
        
        // Apply to selects
        var micSelect = document.getElementById('micSelect');
        var cameraSelect = document.getElementById('cameraSelect');
        var audioOutputSelect = document.getElementById('audioOutputSelect');
        
        if (micSelect && selectedDevices.microphone) {
            micSelect.value = selectedDevices.microphone;
        }
        if (cameraSelect && selectedDevices.camera) {
            cameraSelect.value = selectedDevices.camera;
        }
        if (audioOutputSelect && selectedDevices.audioOutput) {
            audioOutputSelect.value = selectedDevices.audioOutput;
        }
    }
    
    // Load ring volume
    var savedVolume = localStorage.getItem('nevax_ring_volume');
    if (savedVolume) {
        var ringVolume = document.getElementById('ringVolume');
        var ringVolumeValue = document.getElementById('ringVolumeValue');
        if (ringVolume) ringVolume.value = savedVolume;
        if (ringVolumeValue) ringVolumeValue.textContent = savedVolume + '%';
    }
}

// Update toggleSettings function
window.toggleSettings = function() {
    var panel = document.getElementById('settingsPanel');
    if (panel) {
        var isVisible = panel.style.display === 'block';
        panel.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            // Refresh devices when opening
            enumerateDevices();
            loadDevices();
        }
    }
};

// Update startCall to use selected devices
var originalStartCall = startCall;
startCall = async function() {
    var friendInput = document.getElementById('friendIdInput');
    var target = friendInput ? friendInput.value : targetId;
    
    // Update constraints with selected devices
    if (localStream) {
        localStream.getTracks().forEach(function(track) { track.stop(); });
    }
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: videoEnabled ? getVideoConstraints() : false
        });
        
        // Apply audio output if set
        if (selectedDevices.audioOutput) {
            var audioElements = document.querySelectorAll('audio');
            audioElements.forEach(function(audio) {
                if (audio.setSinkId) {
                    audio.setSinkId(selectedDevices.audioOutput).catch(function(err) {
                        console.error('Failed to set audio output:', err);
                    });
                }
            });
        }
        
        addCallToHistory(target, 'Friend #' + target, 'outgoing', false);
    } catch (err) {
        console.error('Failed to get user media:', err);
        alert('Failed to access microphone/camera: ' + err.message);
        return;
    }
    
    return originalStartCall();
};

// ==================== VIDEO FUNCTIONS ====================
var videoEnabled = false;
var videoPreviewStream = null;

window.toggleVideo = function(e) {
    if (e) e.stopPropagation();
    
    var videoBtn = document.getElementById('videoBtn');
    var videoContainer = document.getElementById('videoContainer');
    var localVideo = document.getElementById('localVideo');
    var settingVideoPreview = document.getElementById('settingVideoPreview');
    
    if (!videoEnabled) {
        // Start video (preview or call)
        startVideoPreview();
        if (videoBtn) videoBtn.classList.add('active');
        videoEnabled = true;
        if (settingVideoPreview) settingVideoPreview.checked = true;
    } else {
        // Stop video
        stopVideoPreview();
        if (videoBtn) videoBtn.classList.remove('active');
        videoEnabled = false;
        if (settingVideoPreview) settingVideoPreview.checked = false;
    }
};

async function startVideoPreview() {
    var localVideo = document.getElementById('localVideo');
    var videoContainer = document.getElementById('videoContainer');
    
    try {
        videoPreviewStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        });
        
        if (localVideo) {
            localVideo.srcObject = videoPreviewStream;
            localVideo.style.display = 'block';
        }
        
        // Show video container with just local video
        if (videoContainer) {
            videoContainer.style.display = 'block';
            // Hide remote video in preview mode
            var remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo) remoteVideo.style.display = 'none';
        }
        
        console.log('Video preview started');
    } catch (err) {
        console.error('Failed to start video preview:', err);
        alert('Camera access denied or not available');
    }
}

function stopVideoPreview() {
    var localVideo = document.getElementById('localVideo');
    var videoContainer = document.getElementById('videoContainer');
    
    if (videoPreviewStream) {
        videoPreviewStream.getTracks().forEach(track => track.stop());
        videoPreviewStream = null;
    }
    
    if (localVideo) {
        localVideo.srcObject = null;
        localVideo.style.display = 'none';
    }
    
    if (videoContainer && !inCall) {
        videoContainer.style.display = 'none';
    }
    
    console.log('Video preview stopped');
}

// ==================== CONTACTS FUNCTIONS ====================
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
    
    contacts.forEach(function(contact) {
        var item = document.createElement('div');
        item.className = 'nvx-contact-item';
        item.setAttribute('data-id', contact.id);
        item.innerHTML = 
            '<div class="nvx-contact-status ' + (contact.online ? 'online' : 'offline') + '"></div>' +
            '<span class="nvx-contact-name">' + contact.name + ' (#' + contact.id + ')</span>' +
            '<button class="nvx-contact-call" onclick="callContact(\'' + contact.id + '\')">' +
            '<i class="fa-solid fa-phone"></i>' +
            '</button>';
        list.appendChild(item);
    });
    
    if (contacts.length === 0) {
        list.innerHTML = '<div class="nvx-contact-item"><span class="nvx-contact-name">No contacts yet</span></div>';
    }
}

window.addContact = function() {
    var friendInput = document.getElementById('friendIdInput');
    var friendId = friendInput ? friendInput.value : prompt('Enter friend ID:');
    
    if (!friendId || friendId.trim() === '') return;
    
    var name = prompt('Enter contact name:', 'Friend #' + friendId);
    if (!name) return;
    
    // Check if already exists
    if (contacts.find(c => c.id === friendId)) {
        alert('Contact already exists!');
        return;
    }
    
    contacts.push({
        id: friendId,
        name: name,
        online: false,
        lastSeen: null
    });
    
    saveContacts();
    renderContacts();
    console.log('Contact added:', friendId);
};

window.callContact = function(contactId) {
    var friendInput = document.getElementById('friendIdInput');
    if (friendInput) friendInput.value = contactId;
    
    targetId = contactId;
    
    if (!socket) initConnection();
    startCall();
};

// ==================== SETTINGS FUNCTIONS ====================
var settings = {
    echoCancellation: true,
    noiseSuppression: true,
    videoPreview: false,
    autoAnswer: false
};

function loadSettings() {
    var saved = localStorage.getItem('nevax_settings');
    if (saved) {
        settings = JSON.parse(saved);
        applySettings();
    }
}

function saveSettings() {
    localStorage.setItem('nevax_settings', JSON.stringify(settings));
}

function applySettings() {
    var echoCheck = document.getElementById('settingEcho');
    var noiseCheck = document.getElementById('settingNoise');
    var videoCheck = document.getElementById('settingVideoPreview');
    var autoAnswerCheck = document.getElementById('settingAutoAnswer');
    
    if (echoCheck) echoCheck.checked = settings.echoCancellation;
    if (noiseCheck) noiseCheck.checked = settings.noiseSuppression;
    if (videoCheck) videoCheck.checked = settings.videoPreview;
    if (autoAnswerCheck) autoAnswerCheck.checked = settings.autoAnswer;
}

window.toggleSettings = function() {
    var panel = document.getElementById('settingsPanel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
};

// Settings change handlers
document.addEventListener('DOMContentLoaded', function() {
    var echoCheck = document.getElementById('settingEcho');
    var noiseCheck = document.getElementById('settingNoise');
    var videoCheck = document.getElementById('settingVideoPreview');
    var autoAnswerCheck = document.getElementById('settingAutoAnswer');
    
    if (echoCheck) {
        echoCheck.addEventListener('change', function() {
            settings.echoCancellation = this.checked;
            saveSettings();
        });
    }
    
    if (noiseCheck) {
        noiseCheck.addEventListener('change', function() {
            settings.noiseSuppression = this.checked;
            saveSettings();
        });
    }
    
    if (videoCheck) {
        videoCheck.addEventListener('change', function() {
            settings.videoPreview = this.checked;
            if (this.checked && !videoEnabled) {
                toggleVideo();
            } else if (!this.checked && videoEnabled) {
                toggleVideo();
            }
            saveSettings();
        });
    }
    
    if (autoAnswerCheck) {
        autoAnswerCheck.addEventListener('change', function() {
            settings.autoAnswer = this.checked;
            saveSettings();
        });
    }
});

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
    localStorage.setItem('nevax_call_history', JSON.stringify(callHistory));
}

function renderCallHistory() {
    var list = document.getElementById('historyList');
    if (!list) return;
    
    if (callHistory.length === 0) {
        list.innerHTML = '<div class="nvx-history-empty">No calls yet</div>';
        return;
    }
    
    list.innerHTML = '';
    
    // Show last 10 calls
    callHistory.slice(-10).reverse().forEach(function(call) {
        var item = document.createElement('div');
        item.className = 'nvx-history-item ' + (call.missed ? 'missed' : call.type);
        
        var date = new Date(call.time);
        var timeStr = date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
        
        item.innerHTML = 
            '<span>' + call.contactName + ' (#' + call.contactId + ')</span>' +
            '<span>' + timeStr + '</span>';
        
        list.appendChild(item);
    });
}

function addCallToHistory(contactId, contactName, type, missed) {
    callHistory.push({
        contactId: contactId,
        contactName: contactName,
        type: type, // 'incoming', 'outgoing'
        missed: missed,
        time: Date.now()
    });
    
    // Keep only last 50 calls
    if (callHistory.length > 50) {
        callHistory = callHistory.slice(-50);
    }
    
    saveCallHistory();
    renderCallHistory();
}

// Update call history on connect/disconnect
var originalStartCall = startCall;
startCall = async function() {
    var friendInput = document.getElementById('friendIdInput');
    var target = friendInput ? friendInput.value : targetId;
    
    addCallToHistory(target, 'Friend #' + target, 'outgoing', false);
    return originalStartCall();
};

// ==================== CHAT FUNCTIONS ====================
window.sendChatMessage = function() {
    var input = document.getElementById('chatInput');
    var messages = document.getElementById('chatMessages');
    
    if (!input || !messages) return;
    
    var text = input.value.trim();
    if (!text) return;
    
    // Add to UI
    var msg = document.createElement('div');
    msg.className = 'nvx-chat-message';
    msg.textContent = 'You: ' + text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    
    // Send via socket
    if (socket && targetId) {
        socket.emit('signal', {
            to: targetId,
            from: myId,
            type: 'chat',
            text: text
        });
    }
    
    input.value = '';
};

// Handle Enter key in chat
document.addEventListener('DOMContentLoaded', function() {
    var chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });
    }
});

// Handle incoming chat messages
var originalHandleSignal = handleSignal;
handleSignal = async function(data) {
    if (data.type === 'chat') {
        var messages = document.getElementById('chatMessages');
        if (messages) {
            var msg = document.createElement('div');
            msg.className = 'nvx-chat-message';
            msg.textContent = 'Friend: ' + data.text;
            messages.appendChild(msg);
            messages.scrollTop = messages.scrollHeight;
        }
        return;
    }
    
    // Handle incoming call for auto-answer
    if (data.type === 'offer' && settings.autoAnswer) {
        console.log('Auto-answering call...');
    }
    
    return originalHandleSignal(data);
};

// ==================== STATS UPDATE ====================
function updateConnectionStats() {
    if (!peerConnection || !inCall) {
        document.getElementById('connectionStats').style.display = 'none';
        return;
    }
    
    document.getElementById('connectionStats').style.display = 'flex';
    
    peerConnection.getStats().then(function(stats) {
        stats.forEach(function(report) {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                // Round trip time
                if (report.currentRoundTripTime) {
                    var ping = Math.round(report.currentRoundTripTime * 1000);
                    document.getElementById('statPing').textContent = ping;
                }
            }
            
            if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                // Bitrate
                if (report.targetBitrate) {
                    var bitrate = Math.round(report.targetBitrate / 1000);
                    document.getElementById('statBitrate').textContent = bitrate;
                }
                
                // Packet loss
                if (report.packetsLost !== undefined && report.packetsSent) {
                    var loss = ((report.packetsLost / (report.packetsSent + report.packetsLost)) * 100).toFixed(1);
                    document.getElementById('statLoss').textContent = loss;
                }
            }
        });
    });
}

// Update stats every 2 seconds
setInterval(updateConnectionStats, 2000);
