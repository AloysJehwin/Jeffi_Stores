
document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const category = urlParams.get("category");
    
    document.getElementById("category-title").innerText = category + " Collection";
  
    try {
      const response = await fetch(`http://localhost:3000/api/products/${category}`);
      const products = await response.json();
      
      const productContainer = document.getElementById("product-container");
      productContainer.innerHTML = ""; // Clear existing content
  
      products.forEach(product => {
        const productCard = `
          <div class="col-md-4">
            <div class="card h-100 shadow rounded">
              <img src="${product.imageUrl}" class="card-img-top w-75" alt="${product.title}">
              <div class="card-body">
                <h5 class="card-title">${product.title}</h5>
                <p class="card-text">Brand: ${product.brand}</p>
              </div>
            </div>
          </div>
        `;
        productContainer.innerHTML += productCard;
      });
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  });
  