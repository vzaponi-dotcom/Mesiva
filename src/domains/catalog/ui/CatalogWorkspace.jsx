import { useCatalogCommands } from '../application/useCatalogCommands.js'
import './product-form.css'
import { useProductEditor } from '../application/useProductEditor.js'
import Products from './Products.jsx'
import ProductEditorDialog from './ProductEditorDialog.jsx'

export default function CatalogWorkspace({
  visible,
  products,
  search,
  queryState,
  onSearchChange,
  onQueryChange,
  currency,
  writesBlocked,
  canManageProducts,
  applyOfficialEffects,
  setRequestKey,
  onSuccess,
  onError,
}) {
  const commands = useCatalogCommands({
    writesBlocked,
    canManageProducts,
    applyOfficialEffects,
    setRequestKey,
    onSuccess,
    onError,
  })
  const editor = useProductEditor({
    ownerKey: applyOfficialEffects,
    createProduct: commands.createProduct,
    updateProduct: commands.updateProduct,
    writesBlocked,
    canManageProducts,
  })

  const removeProduct = async (productId) => {
    const accepted = await commands.deleteProduct(productId)
    if (accepted) editor.closeIfEditing(productId)
    return accepted
  }

  return (
    <>
      {visible && (
        <Products
          products={products}
          search={search}
          currency={currency}
          queryState={queryState}
          onQueryChange={onQueryChange}
          onSearchChange={onSearchChange}
          onAdd={editor.openNewProduct}
          onEdit={editor.editProduct}
          onDelete={removeProduct}
          canManageProducts={canManageProducts}
        />
      )}
      {canManageProducts && <ProductEditorDialog editor={editor} writesBlocked={writesBlocked} />}
    </>
  )
}
