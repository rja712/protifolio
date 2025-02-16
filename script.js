document.addEventListener("DOMContentLoaded", function() {
    console.log("Portfolio loaded successfully!");

    // Dynamic Greeting based on Time
    const greetingElement = document.getElementById("greeting");
    const hour = new Date().getHours();
    let greetingMessage = "Welcome to my portfolio!";

    if (hour >= 5 && hour < 12) {
        greetingMessage = "Good morning! Hope you have a productive day!";
    } else if (hour >= 12 && hour < 18) {
        greetingMessage = "Good afternoon! Keep hustling!";
    } else if (hour >= 18 && hour < 22) {
        greetingMessage = "Good evening! Hope you had a great day!";
    } else {
        greetingMessage = "Burning the midnight oil? Keep going!";
    }

    greetingElement.textContent = greetingMessage;

    // Quirky Hover Effect on Name
    const nameElement = document.getElementById("quirky-name");

    nameElement.addEventListener("mouseover", function() {
        nameElement.textContent = "Ankit \"The Code Wizard\" Raj";
    });

    nameElement.addEventListener("mouseout", function() {
        nameElement.textContent = "Ankit Raj";
    });
});