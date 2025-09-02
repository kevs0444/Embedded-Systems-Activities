// Lightweight chart implementation without external dependencies
class SimpleChart {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.data = { labels: [], datasets: [] };
        this.options = options;
        this.colors = ['#2196f3', '#4caf50', '#ff9800', '#f44336'];
        this.maxPoints = options.maxPoints || 20;
        this.hidden = false;
        this.tooltip = null;
        this.padding = 40;
        
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => this.hideTooltip());
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.ctx.scale(dpr, dpr);
        
        if (this.data.labels.length > 0) {
            this.draw();
        }
    }

    setTooltip(tooltipElement) {
        this.tooltip = tooltipElement;
    }

    handleMouseMove(e) {
        if (this.hidden || !this.tooltip || !this.data.labels.length) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const chartWidth = this.canvas.width / (window.devicePixelRatio || 1) - this.padding * 2;
        const stepX = chartWidth / (this.data.labels.length - 1 || 1);
        
        const dataIndex = Math.round((x - this.padding) / stepX);
        
        if (dataIndex >= 0 && dataIndex < this.data.labels.length) {
            this.showTooltip(e.clientX, e.clientY, dataIndex);
        } else {
            this.hideTooltip();
        }
    }

    showTooltip(x, y, index) {
        const label = this.data.labels[index];
        const temp = this.data.datasets[0]?.data[index];
        const humidity = this.data.datasets[1]?.data[index];

        this.tooltip.innerHTML = `
            <div class="tooltip-time">${label}</div>
            <div class="tooltip-data">
                <div class="tooltip-item">
                    <div class="tooltip-color" style="background: #2196f3;"></div>
                    <span>Temperature: ${temp?.toFixed(1) || '--'}°C</span>
                </div>
                <div class="tooltip-item">
                    <div class="tooltip-color" style="background: #4caf50;"></div>
                    <span>Humidity: ${humidity?.toFixed(1) || '--'}%</span>
                </div>
            </div>
        `;

        // Fix: position relative to canvas container
        const rect = this.canvas.getBoundingClientRect();
        const offsetX = x - rect.left;
        const offsetY = y - rect.top;

        this.tooltip.style.left = `${offsetX + 15}px`;
        this.tooltip.style.top = `${offsetY - 15}px`;

        this.tooltip.classList.add('show');
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.classList.remove('show');
        }
    }

    setData(data) {
        this.data = data;
        this.draw();
    }

    addData(label, values) {
        this.data.labels.push(label);
        values.forEach((value, i) => {
            if (!this.data.datasets[i]) {
                this.data.datasets[i] = { data: [] };
            }
            this.data.datasets[i].data.push(value);
        });

        if (this.data.labels.length > this.maxPoints) {
            this.data.labels.shift();
            this.data.datasets.forEach(dataset => dataset.data.shift());
        }
        this.draw();
    }

    draw() {
        if (this.hidden) return;
        
        const { width, height } = this.canvas;
        const ctx = this.ctx;
        const padding = this.padding;
        const chartWidth = width / (window.devicePixelRatio || 1) - padding * 2;
        const chartHeight = height / (window.devicePixelRatio || 1) - padding * 2;

        ctx.clearRect(0, 0, width, height);
        
        if (!this.data.labels.length) return;

        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#fff' : '#333';
        const gridColor = isDark ? '#404040' : '#e0e0e0';

        let min = Infinity, max = -Infinity;
        this.data.datasets.forEach(dataset => {
            dataset.data.forEach(value => {
                min = Math.min(min, value);
                max = Math.max(max, value);
            });
        });
        
        const range = max - min || 1;
        const stepX = chartWidth / (this.data.labels.length - 1 || 1);

        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < 5; i++) {
            const y = padding + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width / (window.devicePixelRatio || 1) - padding, y);
            ctx.stroke();
        }

        this.data.datasets.forEach((dataset, index) => {
            ctx.strokeStyle = this.colors[index];
            ctx.lineWidth = 2;
            ctx.beginPath();

            dataset.data.forEach((value, i) => {
                const x = padding + i * stepX;
                const y = padding + chartHeight - ((value - min) / range) * chartHeight;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            ctx.fillStyle = this.colors[index];
            dataset.data.forEach((value, i) => {
                const x = padding + i * stepX;
                const y = padding + chartHeight - ((value - min) / range) * chartHeight;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            });
        });

        ctx.fillStyle = textColor;
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        for (let i = 0; i <= 4; i++) {
            const value = min + (range / 4) * (4 - i);
            const y = padding + (chartHeight / 4) * i;
            ctx.fillText(value.toFixed(1), 25, y + 4);
        }
    }

    toggle() {
        this.hidden = !this.hidden;
        this.canvas.style.display = this.hidden ? 'none' : 'block';
        if (!this.hidden) this.draw();
    }
}

// Global vars
let realChart, histChart;
let errorNotificationShown = false;

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCharts();
    initNotifications();
    loadHistoricalData();
    fetchData();
    setInterval(fetchData, 5000);

    document.getElementById('clearData').onclick = clearHistoricalData;
});

function initTheme() {
    const themeBtn = document.getElementById('themeBtn');
    const saved = 'light';
    
    document.body.setAttribute('data-theme', saved);
    themeBtn.textContent = saved === 'light' ? '🌙' : '☀️';
    
    themeBtn.onclick = () => {
        const current = document.body.getAttribute('data-theme');
        const newTheme = current === 'light' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', newTheme);
        themeBtn.textContent = newTheme === 'light' ? '🌙' : '☀️';
        
        setTimeout(() => {
            realChart.draw();
            histChart.draw();
        }, 100);
    };
}

function initCharts() {
    const realCanvas = document.getElementById('realChart');
    const histCanvas = document.getElementById('histChart');
    
    realChart = new SimpleChart(realCanvas, { maxPoints: 20 });
    histChart = new SimpleChart(histCanvas, { maxPoints: 500 }); // Increased for historical data
    
    realChart.setTooltip(document.getElementById('realTooltip'));
    histChart.setTooltip(document.getElementById('histTooltip'));
    
    document.getElementById('toggleReal').onclick = () => realChart.toggle();
    document.getElementById('toggleHist').onclick = () => histChart.toggle();
}

function loadHistoricalData() {
    // Load historical data from backend on page load
    fetch('/load_history')
        .then(res => res.json())
        .then(data => {
            if (data.labels && data.labels.length > 0) {
                histChart.setData({
                    labels: data.labels,
                    datasets: [
                        { data: data.temp },
                        { data: data.hum }
                    ]
                });
                console.log(`Loaded ${data.labels.length} historical data points`);
            }
        })
        .catch(error => {
            console.error('Error loading historical data:', error);
        });
}

async function fetchData() {
    try {
        const response = await fetch('/sensor');
        const data = await response.json();
        
        updateStatus(true);
        
        if (data.error || data.temperature === null || data.humidity === null) {
            updateUI('--', '--', 'OFF');
            showErrorNotification();
        } else {
            updateUI(data.temperature, data.humidity, data.buzzer);
            updateRealTimeChart(data.temperature, data.humidity);
            hideErrorNotification();
        }
        
        updateTime();
    } catch (error) {
        console.error('Fetch error:', error);
        updateStatus(false);
        showErrorNotification();
    }
}

function updateUI(temp, hum, buzzer) {
    document.getElementById('temp').textContent = temp;
    document.getElementById('humidity').textContent = hum;
    
    const tempBadge = document.getElementById('tempBadge');
    const t = parseFloat(temp);
    if (t >= 38) {
        tempBadge.className = 'badge danger';
        tempBadge.textContent = '⚠️ High';
    } else if (t >= 30) {
        tempBadge.className = 'badge warn';
        tempBadge.textContent = '🔶 Warm';
    } else if (!isNaN(t)) {
        tempBadge.className = 'badge ok';
        tempBadge.textContent = '✅ Normal';
    } else {
        tempBadge.className = 'badge';
        tempBadge.textContent = '--';
    }
    
    const buzzerIcon = document.getElementById('buzzer');
    const buzzerText = document.getElementById('buzzerText');
    const buzzerStatusIcon = document.getElementById('buzzerStatusIcon');
    const buzzerBadge = document.getElementById('buzzerBadge');
    const isAlert = buzzer === 'ON' || t >= 38;
    
    if (isAlert) {
        buzzerIcon.className = 'buzzer-icon buzzer-active';
        buzzerText.textContent = 'ALERT';
        buzzerStatusIcon.src = '/static/icons/speaker.png';
        buzzerStatusIcon.alt = 'Speaker Icon';
        buzzerBadge.className = 'badge danger';
    } else {
        buzzerIcon.className = 'buzzer-icon';
        buzzerText.textContent = 'Standby';
        buzzerStatusIcon.src = '/static/icons/mute.png';
        buzzerStatusIcon.alt = 'Mute Icon';
        buzzerBadge.className = 'badge ok';
    }
}

function updateRealTimeChart(temp, hum) {
    const time = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    realChart.addData(time, [parseFloat(temp), parseFloat(hum)]);
}

function updateStatus(connected) {
    document.getElementById('status').textContent = connected ? '🟢' : '🔴';
}

function updateTime() {
    document.getElementById('time').textContent = new Date().toLocaleTimeString();
}

function initNotifications() {
    document.getElementById('closeNotif').onclick = hideErrorNotification;
}

function showErrorNotification() {
    if (!errorNotificationShown) {
        document.getElementById('errorNotif').classList.add('show');
        errorNotificationShown = true;
    }
}

function hideErrorNotification() {
    document.getElementById('errorNotif').classList.remove('show');
    errorNotificationShown = false;
}

function clearHistoricalData() {
    if (confirm('Are you sure you want to clear all historical data? This action cannot be undone.')) {
        fetch('/clear_history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                histChart.setData({
                    labels: [],
                    datasets: [{ data: [] }, { data: [] }]
                });
                alert('Historical data cleared successfully!');
            } else {
                alert('Error clearing data: ' + data.message);
            }
        })
        .catch(error => {
            console.error('Error clearing historical data:', error);
            alert('Error clearing data. Please try again.');
        });
    }
}

// Refresh historical data every 5 minutes
setInterval(() => {
    loadHistoricalData();
}, 300000); // 5 minutes

// Optional: Add a manual refresh button for historical data
function refreshHistoricalData() {
    loadHistoricalData();
}