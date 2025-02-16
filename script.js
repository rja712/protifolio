document.addEventListener("DOMContentLoaded", function() {
    console.log("Portfolio loaded successfully!");
    
    const toggleSwitch = document.querySelector('#checkbox');
    const themeLabel = document.querySelector('.theme-label');
    
    // Check for saved theme preference, default to light if none exists
    const currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    // Set initial state
    if (currentTheme === 'light') {
        toggleSwitch.checked = true;
        themeLabel.textContent = 'Light Mode';
    } else {
        toggleSwitch.checked = false;
        themeLabel.textContent = 'Dark Mode';
    }
    
    // Handle theme switch
    toggleSwitch.addEventListener('change', function(e) {
        if (e.target.checked) {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
            themeLabel.textContent = 'Light Mode';
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
            themeLabel.textContent = 'Dark Mode';
        }
    });
});