document.addEventListener('DOMContentLoaded', () => {
    // --- Login Logic ---
    const loginForm = document.getElementById('login-form');
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    const loginError = document.getElementById('login-error');
    
    if (loginForm) {
        let isRegisterMode = false;
        const toggleRegisterBtn = document.getElementById('toggle-register');
        const loginTitle = document.getElementById('login-title');
        const submitBtn = document.getElementById('login-submit-btn');

        toggleRegisterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            isRegisterMode = !isRegisterMode;
            if (isRegisterMode) {
                loginTitle.textContent = "Create an Account";
                submitBtn.textContent = "Register";
                toggleRegisterBtn.textContent = "Already have an account? Sign In";
            } else {
                loginTitle.textContent = "Welcome to REMS";
                submitBtn.textContent = "Sign In";
                toggleRegisterBtn.textContent = "Don't have an account? Register";
            }
            loginError.style.display = 'none';
        });

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('login-password').value;
            const username = document.getElementById('login-username').value;
            
            // Show loading animation on button
            const originalBtnText = submitBtn.innerHTML;
            submitBtn.innerHTML = `<i class="ph ph-spinner"></i> ${isRegisterMode ? 'Registering...' : 'Signing in...'}`;
            submitBtn.disabled = true;
            loginError.style.display = 'none';
            loginError.style.color = '#dc3545'; // Default error color

            const endpoint = isRegisterMode ? '/api/register' : '/api/login';

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: username, password: password })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    if (isRegisterMode) {
                        // Registration successful
                        loginError.style.color = 'var(--primary)';
                        loginError.textContent = "Registration successful! You can now sign in.";
                        loginError.style.display = 'block';
                        
                        // Switch back to login mode automatically
                        isRegisterMode = false;
                        loginTitle.textContent = "Welcome to REMS";
                        toggleRegisterBtn.textContent = "Don't have an account? Register";
                        document.getElementById('login-password').value = ''; // clear password
                        
                        submitBtn.innerHTML = "Sign In";
                        submitBtn.disabled = false;
                    } else {
                        // Login successful
                        const profileName = document.querySelector('.user-profile span');
                        if(profileName) {
                            profileName.textContent = username.charAt(0).toUpperCase() + username.slice(1);
                        }
                        
                        // Trigger animations
                        loginScreen.classList.add('fade-out');
                        setTimeout(() => {
                            loginScreen.style.display = 'none';
                            loginScreen.classList.remove('fade-out');
                            mainApp.style.display = 'flex';
                            mainApp.classList.add('fade-in');
                            
                            submitBtn.innerHTML = "Sign In";
                            submitBtn.disabled = false;
                            
                            setTimeout(() => {
                                mainApp.classList.remove('fade-in');
                            }, 500);
                        }, 500);
                    }
                } else {
                    // Invalid password or register error
                    loginError.textContent = data.message || "An error occurred";
                    loginError.style.display = 'block';
                    submitBtn.innerHTML = isRegisterMode ? "Register" : "Sign In";
                    submitBtn.disabled = false;
                }
            } catch (error) {
                console.error("Auth Error:", error);
                loginError.textContent = "Cannot connect to server.";
                loginError.style.display = 'block';
                submitBtn.innerHTML = isRegisterMode ? "Register" : "Sign In";
                submitBtn.disabled = false;
            }
        });
    }

    // --- Logout & Profile Dropdown Logic ---
    const userProfileBtn = document.getElementById('user-profile-btn');
    const profileDropdown = document.getElementById('profile-dropdown');
    const logoutBtn = document.getElementById('logout-btn');

    if (userProfileBtn && profileDropdown) {
        // Toggle dropdown
        userProfileBtn.addEventListener('click', (e) => {
            profileDropdown.classList.toggle('show');
            e.stopPropagation(); // Prevent document click from immediately closing it
        });

        // Close dropdown when clicking anywhere else
        document.addEventListener('click', () => {
            profileDropdown.classList.remove('show');
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            profileDropdown.classList.remove('show');
            
            // Fade out main app
            mainApp.classList.add('fade-out');
            
            setTimeout(() => {
                mainApp.style.display = 'none';
                mainApp.classList.remove('fade-out');
                
                // Show and fade in login screen
                loginScreen.style.display = 'flex';
                loginScreen.classList.add('fade-in');
                
                // Reset login form
                document.getElementById('login-password').value = '';
                loginError.style.display = 'none';
                
                setTimeout(() => {
                    loginScreen.classList.remove('fade-in');
                }, 500);
            }, 500);
        });
    }

    // DOM Elements
    const navItems = document.querySelectorAll('.main-nav li');
    const contentArea = document.getElementById('content-area');
    const pageTitle = document.getElementById('page-title');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    
    // Date & Time Update
    const dateEl = document.getElementById('current-date');
    const timeEl = document.getElementById('current-time');
    
    function updateDateTime() {
        const now = new Date();
        const options = { month: 'long', day: '2-digit', year: 'numeric' };
        dateEl.textContent = now.toLocaleDateString('en-US', options);
        
        let hours = now.getHours();
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12;
        hours = hours ? hours : 12; 
        timeEl.textContent = `${hours}:${minutes} ${ampm} PHT`;
    }
    
    setInterval(updateDateTime, 60000);
    updateDateTime();
    
    // Mobile menu toggle
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }
    
    // Navigation handling
    function loadPage(pageId) {
        // Update Title
        const selectedNav = document.querySelector(`li[data-page="${pageId}"]`);
        if (selectedNav) {
            pageTitle.textContent = selectedNav.querySelector('span').textContent.toUpperCase();
            
            // Update active state
            navItems.forEach(item => item.classList.remove('active'));
            selectedNav.classList.add('active');
        }
        
        // Load content from template
        const templateId = `tpl-${pageId}`;
        const template = document.getElementById(templateId);
        
        contentArea.innerHTML = ''; // Clear current content
        
        if (template) {
            contentArea.appendChild(template.content.cloneNode(true));
            
            // Initialize page specific scripts
            if (pageId === 'dashboard') {
                initDashboardCharts();
            } else if (pageId === 'ai-recommendations') {
                loadAISuggestions();
            }
        } else {
            // Fallback for missing templates
            const genericTemplate = document.getElementById('tpl-generic');
            if (genericTemplate) {
                contentArea.appendChild(genericTemplate.content.cloneNode(true));
            }
        }
        
        // Close sidebar on mobile after navigation
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('open');
        }
    }
    
    // Set up click listeners for nav
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            loadPage(pageId);
        });
    });
    
    // Initial load
    loadPage('dashboard');

    // --- AI Suggestions Logic ---
    async function loadAISuggestions() {
        const listContainer = document.getElementById('ai-suggestions-list');
        if (!listContainer) return;
        
        try {
            const res = await fetch('/api/suggestions');
            const suggestions = await res.json();
            
            listContainer.innerHTML = ''; // Clear loading
            
            if (suggestions.length === 0) {
                listContainer.innerHTML = `
                    <tr>
                        <td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted);">
                            No new AI suggestions or anomalies detected.
                        </td>
                    </tr>
                `;
                return;
            }
            
            suggestions.forEach(item => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = "1px solid var(--border-color)";
                
                tr.innerHTML = `
                    <td style="padding: 12px; font-size: 13px;">${item.timestamp}</td>
                    <td style="padding: 12px; font-weight: 500;">${item.message}</td>
                    <td style="padding: 12px;">
                        <span class="status-badge active">${item.confidence}</span>
                    </td>
                    <td style="padding: 12px; display: flex; gap: 8px;">
                        <button class="btn btn-primary" onclick="handleSuggestion(${item.id}, 'approve')" style="padding: 6px 12px; font-size: 12px;">Approve</button>
                        <button class="btn btn-secondary" onclick="handleSuggestion(${item.id}, 'reject')" style="padding: 6px 12px; font-size: 12px; background: #e5e7eb; color: #374151;">Reject</button>
                    </td>
                `;
                listContainer.appendChild(tr);
            });
            
        } catch(e) {
            console.error("Failed to fetch suggestions", e);
            listContainer.innerHTML = `
                <tr>
                    <td colspan="4" style="padding: 20px; text-align: center; color: #dc3545;">
                        Error loading AI suggestions. Check server connection.
                    </td>
                </tr>
            `;
        }
    }
    
    // Global function for buttons
    window.handleSuggestion = async function(id, action) {
        if(!confirm(`Are you sure you want to ${action} this suggestion?`)) return;
        
        try {
            const res = await fetch(`/api/suggestions/${id}/${action}`, { method: 'POST' });
            if (res.ok) {
                // Refresh list
                loadAISuggestions();
            }
        } catch(e) {
            console.error("Error handling suggestion", e);
        }
    };
    
    // --- Chart Initializations ---
    function initDashboardCharts() {
        const primaryColor = '#34a853';
        const primaryLight = 'rgba(52, 168, 83, 0.2)';
        const textColor = '#1f2937';
        const gridColor = '#f3f4f6';
        
        // 1. Power Factor Trend Chart
        const pfTrendCtx = document.getElementById('pfTrendChart');
        if (pfTrendCtx) {
            new Chart(pfTrendCtx, {
                type: 'line',
                data: {
                    labels: ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', '12 AM'],
                    datasets: [{
                        label: 'Power Factor',
                        data: [0.95, 0.96, 0.91, 0.92, 0.95, 0.89, 0.94],
                        borderColor: primaryColor,
                        backgroundColor: primaryLight,
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: primaryColor
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            min: 0.8,
                            max: 1.0,
                            grid: { color: gridColor }
                        },
                        x: {
                            grid: { display: false }
                        }
                    }
                }
            });
        }
        
        // 2. Energy Consumption Chart
        const consumptionCtx = document.getElementById('consumptionChart');
        if (consumptionCtx) {
            new Chart(consumptionCtx, {
                type: 'bar',
                data: {
                    labels: ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', '12 AM'],
                    datasets: [{
                        label: 'Consumption (kWh)',
                        data: [60, 45, 30, 40, 45, 90, 75],
                        backgroundColor: primaryColor,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            grid: { color: gridColor }
                        },
                        x: {
                            grid: { display: false }
                        }
                    }
                }
            });
        }
        
        // 3. Load Distribution Chart
        const distributionCtx = document.getElementById('distributionChart');
        if (distributionCtx) {
            const data = {
                labels: ['Living Room', 'Kitchen', 'Air Conditioner', 'Others'],
                datasets: [{
                    data: [25, 15, 50, 10],
                    backgroundColor: [
                        '#d1d5db', // light gray
                        '#9ca3af', // med gray
                        primaryColor, // green
                        '#6b7280'  // dark gray
                    ],
                    borderWidth: 0,
                    cutout: '70%'
                }]
            };
            
            new Chart(distributionCtx, {
                type: 'doughnut',
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
            
            // Custom Legend
            const legendContainer = document.getElementById('distributionLegend');
            if (legendContainer) {
                legendContainer.innerHTML = '';
                data.labels.forEach((label, index) => {
                    const color = data.datasets[0].backgroundColor[index];
                    const item = document.createElement('div');
                    item.className = 'legend-item';
                    item.innerHTML = `
                        <div class="legend-color" style="background-color: ${color}"></div>
                        <span>${label}</span>
                    `;
                    legendContainer.appendChild(item);
                });
            }
        }
    }
});
